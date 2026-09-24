// Main-process Supervisor relay service (orca-transition plan Task 12).
// Polls the Supervisor's operator-view.json at the contract's 5 s maximum,
// rechecks freshness on a 1 s monotonic tick (so a freeze lands within 5 s
// after the 30 s budget expires), and emits the redacted renderer-safe
// payload. Electron-free: the IPC wiring (supervisor-relay-ipc.ts) supplies
// the broadcast sink, which keeps this unit-testable under fake clocks.
import {
  SUPERVISOR_RELAY_SCHEMA_VERSION,
  type SupervisorRelayPayload,
  type SupervisorRelayUnhostedReason
} from '../../shared/supervisor-relay-types'
import {
  OperatorViewReader,
  READ_MAX_POLL_MS,
  type FsAdapter,
  type FreezeReason,
  type OperatorView,
  type ReadOutcome
} from './operator-view-reader'
import { redactOperatorView } from './redaction'


/** Freeze must be visible within 5 s after the 30 s budget expires → tick faster than the poll. */
export const VALIDITY_TICK_MS = 1_000

export type SupervisorRelayServiceOptions = {
  readonly path: string
  readonly onPayload: (payload: SupervisorRelayPayload) => void
  readonly fs?: FsAdapter
  readonly wallMs?: () => number
  readonly monoMs?: () => number
  readonly pollMs?: number
  readonly tickMs?: number
  /** Task 14: bridge verification per card — jumpAvailable reflects it, unhosted cards carry their reason. */
  readonly cardVerifier?: RelayCardVerifier
}

/** Per-card bridge verification, keyed by card id. A present reason renders the card unhosted. */
export type RelayCardVerifier = (
  view: OperatorView
) => Promise<Map<string, SupervisorRelayUnhostedReason>>

const notRunningPayload: SupervisorRelayPayload = {
  schemaVersion: SUPERVISOR_RELAY_SCHEMA_VERSION,
  generation: 0,
  lastSeq: 0,
  producedAt: '',
  state: 'not-running',
  cards: []
}

function errorPayload(lastGoodGeneration: number, lastGoodSeq: number): SupervisorRelayPayload {
  return {
    schemaVersion: SUPERVISOR_RELAY_SCHEMA_VERSION,
    generation: lastGoodGeneration,
    lastSeq: lastGoodSeq,
    producedAt: '',
    state: 'error',
    freezeReason: 'invalid-schema',
    cards: []
  }
}

export class SupervisorRelayService {
  private readonly reader: OperatorViewReader
  private readonly onPayload: (payload: SupervisorRelayPayload) => void
  private readonly wallMs: () => number
  private readonly monoMs: () => number
  private readonly pollMs: number
  private readonly tickMs: number
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private tickTimer: ReturnType<typeof setInterval> | undefined
  private current: SupervisorRelayPayload = notRunningPayload
  private live = false
  private readonly cardVerifier: RelayCardVerifier | undefined
  private view: OperatorView | undefined

  constructor(options: SupervisorRelayServiceOptions) {
    this.reader = new OperatorViewReader({
      path: options.path,
      ...(options.fs !== undefined ? { fs: options.fs } : {}),
      ...(options.wallMs !== undefined ? { wallMs: options.wallMs } : {}),
      ...(options.monoMs !== undefined ? { monoMs: options.monoMs } : {})
    })
    this.onPayload = options.onPayload
    this.wallMs = options.wallMs ?? Date.now
    this.monoMs = options.monoMs ?? Date.now
    this.pollMs = options.pollMs ?? READ_MAX_POLL_MS
    this.tickMs = options.tickMs ?? VALIDITY_TICK_MS
    this.cardVerifier = options.cardVerifier
  }

  snapshot(): SupervisorRelayPayload {
    return this.current
  }

  /** The latest live view WITH trusted sessionRefs — the focus action's card-id lookup source (never renderer-visible). */
  currentView(): OperatorView | undefined {
    return this.view
  }

  start(): void {
    if (this.pollTimer !== undefined) {
    return
  }
    void this.poll()
    this.pollTimer = setInterval(() => void this.poll(), this.pollMs)
    this.tickTimer = setInterval(() => this.validityTick(), this.tickMs)
  }

  stop(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
    }
    if (this.tickTimer !== undefined) {
      clearInterval(this.tickTimer)
    }
    this.pollTimer = undefined
    this.tickTimer = undefined
    this.live = false
  }

  async poll(): Promise<void> {
    const outcome = await this.reader.read()
    await this.applyOutcome(outcome)
  }

  private validityTick(): void {
    if (!this.live) {
      return
    }
    const outcome = this.reader.validity(this.wallMs(), this.monoMs())
    if (outcome.state === 'frozen') {
      void this.applyOutcome(outcome)
    }
  }

  private async applyOutcome(outcome: ReadOutcome): Promise<void> {
    this.live = outcome.state === 'live'
    let next: SupervisorRelayPayload
    if (outcome.state === 'live') {
      this.view = outcome.view
      const redacted = redactOperatorView(outcome.view, 'live')
      // Redaction cannot fail on a schema-validated v1 view; fail closed to the
      // neutral error card rather than forwarding anything unredacted.
      next = redacted ?? errorPayload(outcome.view.generation, outcome.view.lastSeq)
      if (redacted !== undefined && this.cardVerifier !== undefined) {
        next = applyUnhostedReasons(redacted, await this.cardVerifier(outcome.view))
      }
    } else if (outcome.reason === 'invalid-schema') {
      // Parse/redaction failure → neutral error card, no action (design §5).
      const lastGood = outcome.lastGood
      next = errorPayload(lastGood?.generation ?? 0, lastGood?.lastSeq ?? 0)
    } else if (outcome.lastGood !== undefined) {
      const frozenReason: FreezeReason = outcome.reason
      const redacted = redactOperatorView(outcome.lastGood, 'frozen', frozenReason)
      next = redacted ?? errorPayload(outcome.lastGood.generation, outcome.lastGood.lastSeq)
    } else {
      // No valid image ever received: supervisor not running / no file.
      next = notRunningPayload
    }
    this.emitIfChanged(next)
  }

  private emitIfChanged(next: SupervisorRelayPayload): void {
    // Push only on change: a hydrating renderer pulls the snapshot (getSnapshot),
    // and not-running stays silent so a dead supervisor never spams windows.
    const changed = JSON.stringify(next) !== JSON.stringify(this.current)
    if (!changed) {
      return
    }
    this.current = next
    this.onPayload(next)
  }
}

/** Bridge verification is authoritative for jump availability: an unhosted card loses its jump and carries the scalar reason. */
function applyUnhostedReasons(
  payload: SupervisorRelayPayload,
  unhosted: Map<string, SupervisorRelayUnhostedReason>
): SupervisorRelayPayload {
  return {
    ...payload,
    cards: payload.cards.map((card) => {
      const reason = unhosted.get(card.id)
      return reason === undefined
        ? card
        : { ...card, jumpAvailable: false, unhostedReason: reason }
    })
  }
}
