// Reader-side contract obligations for the Supervisor's operator-view.json,
// ported from the Supervisor repo's operator-view-reader.ts (orca-transition
// plan Task 12; the contract, not the publisher module, is Orca's API — port
// the semantics, never import the Supervisor's code). Binding spec:
// docs/portable-supervisor-contract.md "Reader obligations (c)".
//
// No Electron imports: everything is injectable (fs adapter, wall/monotonic
// clocks) so the module unit-tests under a fake clock.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { parseExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'

/** Contract: stale = producedAt older than 30 s at receipt. */
export const READ_STALE_AGE_MS = 30_000
/** Contract: producedAt more than 5 s in the future = future-skew freeze. */
export const READ_FUTURE_SKEW_MS = 5_000
/** Contract: a wall-clock jump beyond ±5 s must force a fresh read, never extend validity. */
export const READ_CLOCK_JUMP_MS = 5_000
/** Contract: poll at most every 5 s. */
export const READ_MAX_POLL_MS = 5_000
/** Reader-side mirror of the publisher's MAX_CARDS bound (schema rejects larger sets). */
export const READER_MAX_CARDS = 20

/** The parsed (validated) read-model image as published by the Supervisor. */
/** Trusted main-side session identity for a card's jump target (design §5). NEVER forwarded to renderers — redaction drops it. */
export type OperatorViewCardSessionRef = {
  readonly executionHostId: ExecutionHostId
  readonly canonicalRoot: string
  readonly sessionID: string
}

export type OperatorViewCard = {
  readonly id: string
  readonly rootLabel: string
  readonly sessionLabel: string
  readonly reasonText: string
  readonly premiseTexts: readonly string[]
  readonly ageSeconds: number
  readonly severity: 'A' | 'B' | 'C' | 'D'
  readonly jumpAvailable: true
  /** Optional: present only when the Supervisor can name the session's host-qualified identity; absent ⇒ Orca renders the card unhosted. */
  readonly sessionRef?: OperatorViewCardSessionRef
}

export type OperatorView = {
  readonly schemaVersion: 1
  readonly generation: number
  readonly lastSeq: number
  readonly producedAt: string
  readonly cards: readonly OperatorViewCard[]
}

const executionHostIdSchema = z
  .string()
  .min(1)
  .refine((value) => parseExecutionHostId(value) !== null, 'Invalid execution host id')
  .transform((value) => value as ExecutionHostId)

const sessionRefSchema = z.strictObject({
  executionHostId: executionHostIdSchema,
  canonicalRoot: z.string().min(1),
  sessionID: z.string().min(1)
})

const cardSchema = z.strictObject({
  id: z.string().min(1),
  rootLabel: z.string(),
  sessionLabel: z.string(),
  reasonText: z.string(),
  premiseTexts: z.array(z.string()),
  ageSeconds: z.number().finite().nonnegative(),
  severity: z.enum(['A', 'B', 'C', 'D']),
  jumpAvailable: z.literal(true),
  sessionRef: sessionRefSchema.optional()
})

const viewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generation: z.number().int().positive(),
  lastSeq: z.number().int().nonnegative(),
  producedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  cards: z.array(cardSchema).max(READER_MAX_CARDS)
})

export type FreezeReason =
  | 'read-error'
  | 'invalid-schema'
  | 'stale'
  | 'future-skew'
  | 'generation-regression'
  | 'missing-updates'
  | 'clock-jump'

export type ReadOutcome =
  | { readonly state: 'live'; readonly view: OperatorView }
  | {
      readonly state: 'frozen'
      readonly reason: FreezeReason
      readonly lastGood: OperatorView | undefined
    }

export type FsAdapter = { readonly readFile: (path: string) => Promise<string> }

const nodeFsAdapter: FsAdapter = { readFile: (path) => readFile(path, 'utf8') }

/** Schema validation: parse + shape-check raw file bytes into an OperatorView, or undefined. */
export function parseOperatorView(raw: string): OperatorView | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const result = viewSchema.safeParse(parsed)
  if (!result.success) {
    return undefined
  }
  const data = result.data
  return {
    schemaVersion: 1,
    generation: data.generation,
    lastSeq: data.lastSeq,
    producedAt: data.producedAt,
    cards: data.cards
  }
}

export type OperatorViewReaderOptions = {
  readonly path: string
  readonly fs?: FsAdapter
  readonly wallMs?: () => number
  readonly monoMs?: () => number
}

/**
 * Single-image reader enforcing the contract's reader obligations: schema
 * validation, receipt-time staleness (30 s past / 5 s future), monotonic
 * (generation,lastSeq) tracking (older generation or a lastSeq gap/regression
 * freezes), and post-receipt freshness on a monotonic timer where a ±5 s
 * wall-clock jump refuses to extend validity.
 */
export class OperatorViewReader {
  private readonly path: string
  private readonly fs: FsAdapter
  private readonly wallMs: () => number
  private readonly monoMs: () => number
  private prev?: { readonly generation: number; readonly lastSeq: number }
  private lastGood: OperatorView | undefined
  private anchorWallMs = 0
  private anchorMonoMs = 0
  private anchored = false

  constructor(options: OperatorViewReaderOptions) {
    this.path = options.path
    this.fs = options.fs ?? nodeFsAdapter
    this.wallMs = options.wallMs ?? Date.now
    this.monoMs = options.monoMs ?? Date.now
  }

  private frozen(reason: FreezeReason): ReadOutcome {
    return { state: 'frozen', reason, lastGood: this.lastGood }
  }

  /** Fresh read of the file image (reread on rename: every call goes to disk). */
  async read(): Promise<ReadOutcome> {
    let raw: string
    try {
      raw = await this.fs.readFile(this.path)
    } catch {
      return this.frozen('read-error')
    }
    const view = parseOperatorView(raw)
    if (view === undefined) {
      return this.frozen('invalid-schema')
    }
    const wall = this.wallMs()
    const producedMs = Date.parse(view.producedAt)
    if (wall - producedMs > READ_STALE_AGE_MS) {
      return this.frozen('stale')
    }
    if (producedMs - wall > READ_FUTURE_SKEW_MS) {
      return this.frozen('future-skew')
    }
    const prev = this.prev
    if (prev !== undefined) {
      if (view.generation < prev.generation) {
        return this.frozen('generation-regression')
      }
      // Lexicographic (generation,lastSeq) must never regress; within one
      // generation a changed lastSeq means updates were missed (gap/jump).
      if (view.lastSeq < prev.lastSeq) {
        return this.frozen('missing-updates')
      }
      if (view.generation === prev.generation && view.lastSeq !== prev.lastSeq) {
        return this.frozen('missing-updates')
      }
    }
    this.prev = { generation: view.generation, lastSeq: view.lastSeq }
    this.lastGood = view
    this.anchorWallMs = wall
    this.anchorMonoMs = this.monoMs()
    this.anchored = true
    return { state: 'live', view }
  }

  /**
   * Post-receipt freshness recheck on a MONOTONIC timer: stale once 30 s of
   * monotonic time elapsed since receipt, and a wall clock that diverged from
   * the monotonic extrapolation by more than ±5 s (backward or forward) does
   * not extend validity — the caller must perform a fresh read().
   */
  validity(wallMs: number, monoMs: number): ReadOutcome {
    if (!this.anchored || this.lastGood === undefined) {
      return this.frozen('read-error')
    }
    if (monoMs - this.anchorMonoMs > READ_STALE_AGE_MS) {
      return this.frozen('stale')
    }
    const extrapolatedWall = this.anchorWallMs + (monoMs - this.anchorMonoMs)
    if (Math.abs(wallMs - extrapolatedWall) > READ_CLOCK_JUMP_MS) {
      return this.frozen('clock-jump')
    }
    return { state: 'live', view: this.lastGood }
  }
}
