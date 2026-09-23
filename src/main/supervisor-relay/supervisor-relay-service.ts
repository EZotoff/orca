// Main-process Supervisor relay service (orca-transition plan Task 12).
// Polls the Supervisor's operator-view.json at the contract's 5 s maximum,
// rechecks freshness on a 1 s monotonic tick (so a freeze lands within 5 s
// after the 30 s budget expires), and emits the redacted renderer-safe
// payload. Electron-free: the IPC wiring (supervisor-relay-ipc.ts) supplies
// the broadcast sink, which keeps this unit-testable under fake clocks.
import {
  SUPERVISOR_RELAY_SCHEMA_VERSION,
  type SupervisorRelayPayload
} from '../../shared/supervisor-relay-types'
import {
  OperatorViewReader,
  READ_MAX_POLL_MS,
  type FsAdapter,
  type FreezeReason,
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
}

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
  }

  snapshot(): SupervisorRelayPayload {
    return this.current
  }

  start(): void {
    if (this.pollTimer !== undefined) return
    void this.poll()
    this.pollTimer = setInterval(() => void this.poll(), this.pollMs)
    this.tickTimer = setInterval(() => this.validityTick(), this.tickMs)
  }

  stop(): void {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    if (this.tickTimer !== undefined) clearInterval(this.tickTimer)
    this.pollTimer = undefined
    this.tickTimer = undefined
    this.live = false
  }

  async poll(): Promise<void> {
    const outcome = await this.reader.read()
    this.applyOutcome(outcome)
  }

  private validityTick(): void {
    if (!this.live) return
    const outcome = this.reader.validity(this.wallMs(), this.monoMs())
    if (outcome.state === 'frozen') {
      this.applyOutcome(outcome)
    }
  }

  private applyOutcome(outcome: ReadOutcome): void {
    this.live = outcome.state === 'live'
    let next: SupervisorRelayPayload
    if (outcome.state === 'live') {
      const redacted = redactOperatorView(outcome.view, 'live')
      // Redaction cannot fail on a schema-validated v1 view; fail closed to the
      // neutral error card rather than forwarding anything unredacted.
      next = redacted ?? errorPayload(outcome.view.generation, outcome.view.lastSeq)
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
    if (!changed) return
    this.current = next
    this.onPayload(next)
  }
}
