// A send's admission, run again behind the verdict on an owner that had not proven its start.
//
// The serialized step in `structured-agent-session-send-preparation` admits nothing against a
// `starting` child: the `started` and `ended` events that decide it are settled on the same
// per-session queue, so waiting there would wait on itself. The step registers for the verdict
// and returns, and this loop — off the queue — waits, then admits again on `ready`, or ends the
// send with the child's own reason when it exited first. Each admission re-derives everything,
// so a verdict that arrived late or for a child since replaced costs one more step, never a
// wrong answer.

import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { AgentSessionMutationRequest } from './structured-agent-session-mutation-admission'
import {
  ownerUnrecoverableRefusal,
  prepareStructuredAgentSessionSend,
  type SendPreparationContext,
  type StructuredAgentSessionSendStartupWait
} from './structured-agent-session-send-preparation'

type SendPreparationStep = NonNullable<AgentSessionMutationRequest<unknown>['prepareSession']>

/** What a step that must wait answers admission with. The loop below never surfaces it — it waits
 *  instead — but a caller that did not would still hold a true, retryable answer. */
const OWNER_STARTING: AgentSessionWireRefusal = {
  code: 'agent_session_ownership_unknown',
  message: "This chat's agent is still starting."
}

/**
 * Runs `admit` — one serialized admission, with this send's preparation as its `prepareSession`
 * — until the send has its answer. A step that met an owner still proving its start placed
 * nothing; its verdict settles on the session's own queue, so it is awaited here, off it, and the
 * send is admitted again once the owner is `ready`. An owner that exits first ends the send the
 * way a restart that failed outright does, carrying the child's own reason; the exit settlement
 * wrote that reason into the chat, so no second row is written here.
 */
export async function runStructuredAgentSessionSend<TValue>(
  context: SendPreparationContext,
  envelope: AgentSessionMutationEnvelope,
  admit: (prepareSession: SendPreparationStep) => Promise<AgentSessionMutationResult<TValue>>
): Promise<AgentSessionMutationResult<TValue>> {
  const { sessionId } = envelope
  // One spawn per user action, however many verdicts this send waits behind.
  let mayRestart = true
  const waits: StructuredAgentSessionSendStartupWait[] = []
  const prepare: SendPreparationStep = async (ledger, record) => {
    const prepared = await prepareStructuredAgentSessionSend(
      context,
      envelope,
      ledger,
      record,
      mayRestart
    )
    if (!('startup' in prepared)) {
      return prepared
    }
    waits.push(prepared)
    return { ok: false, refusal: OWNER_STARTING }
  }
  for (;;) {
    const result = await admit(prepare)
    const wait = waits.pop()
    if (!wait) {
      return result
    }
    mayRestart &&= !wait.restarted
    const verdict = await wait.startup
    if (verdict.verdict === 'ready') {
      continue
    }
    if (verdict.verdict === 'gone') {
      return {
        ok: false,
        refusal: {
          code: 'agent_session_ownership_unknown',
          message: "This chat's agent was stopped before it finished starting."
        }
      }
    }
    // The adapter proved the exit, whatever the lease's bookkeeping says of it.
    const refusal = ownerUnrecoverableRefusal({
      code: 'agent_session_operation_invalid',
      message: verdict.reason,
      ownerVerdict: 'exited'
    })
    context.deps.onEventSinkError?.({
      sessionId,
      error: new Error(`${refusal.code}: ${verdict.reason}`)
    })
    return { ok: false, refusal }
  }
}
