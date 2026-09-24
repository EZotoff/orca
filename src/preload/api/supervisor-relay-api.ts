import type { SupervisorRelayFocusOutcome, SupervisorRelayPayload } from '../../shared/supervisor-relay-types'

export type SupervisorRelayApi = {
  /** Listen for redacted Supervisor relay payloads pushed from the main-process poller. */
  onUpdate: (callback: (payload: SupervisorRelayPayload) => void) => () => void
  /** Pull the current relay payload once on renderer hydration, so pre-mount state isn't lost. */
  getSnapshot: () => Promise<SupervisorRelayPayload>
  /** Jump to the session behind a card: resolve-then-focus runs in main; only the scalar outcome returns. */
  focus: (cardId: string) => Promise<SupervisorRelayFocusOutcome>
}
