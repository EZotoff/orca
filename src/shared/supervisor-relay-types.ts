// Supervisor relay renderer boundary types (orca-transition plan Task 12).
//
// The ONLY shape the renderer is ever allowed to see for Supervisor
// escalation state. Parse/validation happens exclusively in the trusted
// main process (src/main/supervisor-relay); this payload is scalar
// enum/primitive fields with bounded arrays, whitelisted display text, and
// no raw ledger payloads, agent HTML/Markdown, link targets, filesystem
// paths, socket metadata, or auth tokens. Binding spec:
// docs/portable-supervisor-contract.md "Operator read model" + design
// 40-oracle-design.md §5.
import type { ResolveRejectionReason } from './identity-bridge-types'


export const SUPERVISOR_RELAY_SCHEMA_VERSION = 1

/** Why frozen carries a reason: the UI labels every freeze "Supervisor state stale" but diagnostics keep the cause. */
export type SupervisorRelayFreezeReason =
  | 'read-error'
  | 'invalid-schema'
  | 'stale'
  | 'future-skew'
  | 'generation-regression'
  | 'missing-updates'
  | 'clock-jump'

/**
 * - live: the read model validated and is fresh.
 * - frozen: keep the last good cards grey, jumps disabled, "Supervisor state stale".
 * - not-running: no valid image ever received (supervisor not running / no file).
 * - error: parse/redaction failure — neutral error card, no action.
 */
export type SupervisorRelayState = 'live' | 'frozen' | 'not-running' | 'error'

export type SupervisorRelayCard = {
  readonly id: string
  readonly rootLabel: string
  readonly sessionLabel: string
  readonly reasonText: string
  readonly premiseTexts: readonly string[]
  /** Seconds since the underlying escalation decision, per the read model's ageSeconds. */
  readonly age: number
  readonly severity: 'A' | 'B' | 'C' | 'D'
  readonly jumpAvailable: boolean
  /** Present when the identity bridge cannot verify the session (design §5 unhosted handling); jump is disabled and the fixed label below renders. */
  readonly unhostedReason?: SupervisorRelayUnhostedReason
}

export type SupervisorRelayPayload = {
  readonly schemaVersion: typeof SUPERVISOR_RELAY_SCHEMA_VERSION
  readonly generation: number
  readonly lastSeq: number
  readonly producedAt: string
  readonly state: SupervisorRelayState
  readonly freezeReason?: SupervisorRelayFreezeReason
  readonly cards: readonly SupervisorRelayCard[]
}



/** Why a card is unhosted: the bridge's rejection classes (scalar enum, never raw error text). */
export type SupervisorRelayUnhostedReason = ResolveRejectionReason

/** Renderer-safe jump outcome. 'failed' is focus-API failure with no state change; no raw error text crosses the boundary. */
export type SupervisorRelayFocusOutcome =
  | { readonly status: 'focused' }
  | { readonly status: 'failed' }
  | { readonly status: 'unhosted'; readonly reason: SupervisorRelayUnhostedReason }

export const SUPERVISOR_RELAY_UPDATE_CHANNEL = 'supervisorRelay:update'
export const SUPERVISOR_RELAY_SNAPSHOT_CHANNEL = 'supervisorRelay:getSnapshot'
export const SUPERVISOR_RELAY_FOCUS_CHANNEL = 'supervisorRelay:focus'
