// Renderer-boundary redaction for the Supervisor relay (orca-transition plan
// Task 12). Converts a validated OperatorView into the strictly scalar,
// capped, scrubbed SupervisorRelayPayload — the ONLY shape allowed across the
// main→renderer IPC line. Display text is whitelisted field-by-field; obvious
// credential/token/secret patterns and home-directory absolute paths are
// scrubbed; nothing else from the read model (or the ledger) is forwarded.
import {
  SUPERVISOR_RELAY_SCHEMA_VERSION,
  type SupervisorRelayCard,
  type SupervisorRelayPayload,
  type SupervisorRelayState
} from '../../shared/supervisor-relay-types'
import type { FreezeReason, OperatorView } from './operator-view-reader'

/** Contract/design cap: each forwarded text field is at most 300 chars. */
export const MAX_TEXT_CHARS = 300
/** Contract/design cap: at most 10 premise lines per card. */
export const MAX_PREMISE_TEXTS = 10
/** Contract/design cap: at most 50 cards forwarded to the renderer. */
export const MAX_RELAY_CARDS = 50

const scrubPatterns: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  // OpenAI-style API keys
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: '[redacted-key]' },
  // GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[redacted-token]' },
  // Slack tokens
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: '[redacted-token]' },
  // Bearer credentials (any case)
  { pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, replacement: 'bearer [redacted]' },
  // JWT-shaped strings (three base64url segments starting eyJ)
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[redacted-jwt]' },
  // Home-directory absolute paths (Linux/macOS) and ~-prefixed paths
  { pattern: /(?:\/home\/[A-Za-z0-9_.-]+|\/Users\/[A-Za-z0-9_.-]+|~)\/[^\s"'`]*/g, replacement: '[path]' }
]

function scrub(text: string): string {
  let out = text
  for (const { pattern, replacement } of scrubPatterns) {
    out = out.replace(pattern, replacement)
  }
  return out.slice(0, MAX_TEXT_CHARS)
}

function toRelayCard(card: OperatorView['cards'][number]): SupervisorRelayCard {
  return {
    id: scrub(card.id).slice(0, 200),
    rootLabel: scrub(card.rootLabel),
    sessionLabel: scrub(card.sessionLabel),
    reasonText: scrub(card.reasonText),
    premiseTexts: card.premiseTexts.slice(0, MAX_PREMISE_TEXTS).map(scrub),
    age: Math.max(0, Math.round(card.ageSeconds)),
    severity: card.severity,
    jumpAvailable: card.jumpAvailable === true
  }
}

/**
 * Build the renderer-safe payload. `view` MUST already be schema-validated
 * (parseOperatorView). Returns undefined only if handed a non-v1 view — the
 * caller then surfaces the neutral error card instead of forwarding anything.
 */
export function redactOperatorView(
  view: OperatorView,
  state: SupervisorRelayState,
  freezeReason?: FreezeReason
): SupervisorRelayPayload | undefined {
  if (view.schemaVersion !== SUPERVISOR_RELAY_SCHEMA_VERSION) {
    return undefined
  }
  return {
    schemaVersion: SUPERVISOR_RELAY_SCHEMA_VERSION,
    generation: view.generation,
    lastSeq: view.lastSeq,
    producedAt: view.producedAt,
    state,
    ...(freezeReason !== undefined ? { freezeReason } : {}),
    cards: view.cards.slice(0, MAX_RELAY_CARDS).map(toRelayCard)
  }
}
