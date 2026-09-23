import type { SupervisorRelayPayload } from '../../shared/supervisor-relay-types'

export type SupervisorRelayApi = {
  /** Listen for redacted Supervisor relay payloads pushed from the main-process poller. */
  onUpdate: (callback: (payload: SupervisorRelayPayload) => void) => () => void
  /** Pull the current relay payload once on renderer hydration, so pre-mount state isn't lost. */
  getSnapshot: () => Promise<SupervisorRelayPayload>
}
