import {
  mainAgentStatusEqual,
  type AgentMainAgentStatus,
  type AgentStatusEntry,
  type AgentStatusPayload
} from '../../../../shared/agent-status-types'

/** The main agent fact a live entry carries. A writer with no main agent fact of its own (OSC bytes, launch
 *  seeds) repaints the state the row already holds, and the main agent behind an unchanged state is
 *  unchanged too — the same rule main's OSC ingest applies. The existing object is reused when
 *  nothing changed so subscribers can compare by reference. */
export function resolveAgentStatusLiveEntryMainAgent(
  existing: AgentStatusEntry | undefined,
  payload: Pick<AgentStatusPayload, 'state' | 'mainAgent'>,
  agentType: AgentStatusEntry['agentType']
): AgentMainAgentStatus | undefined {
  const next =
    payload.mainAgent ??
    (existing?.state === payload.state && existing.agentType === agentType
      ? existing.mainAgent
      : undefined)
  return mainAgentStatusEqual(existing?.mainAgent, next) ? existing?.mainAgent : next
}
