// What a send needs from the session before its lease is checked.
//
// A provider child that exits or fails to start hands its lease back. Before this, a send to that
// session was refused `agent_session_ownership_unknown` — which a client reads as "not admitted
// yet" and resends forever — and only a surface hold could ever make a new child. Now the send
// makes sure it has an owner as a step of its own serialized admission: a released lease where
// resume is allowed gets a child first; anything else runs as it is and meets the lease check.
// A restart that fails for good refuses with a code the client stops on.
//
// The ledger's answer comes first, so a send it already holds a row for restarts nothing:
// admission replays or refuses it whoever owns the session now, and a closed session is made
// readable for that, never given a child. Otherwise a child that dies at startup moves the fence,
// the client resends the same message against the new fence, and each replay spawns another
// child that dies the same way.
//
// Running inside the send's serialize is what makes "no child" exact and the fence bookkeeping
// simple: the owner this send (or a hold just ahead of it) replaced is the one the client was
// current as of, so the send is admitted at the fence the restart published.

import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import type { AgentSessionMutationSessionPreparation } from './structured-agent-session-mutation-admission'
import { isResumableStructuredAgentSessionRecord } from './structured-agent-session-resume-eligibility'
import { rewindRefusal } from './structured-rewind-refusal'

export const AGENT_SESSION_OWNER_UNRECOVERABLE: AgentSessionWireRefusal = {
  code: 'agent_session_owner_unrecoverable',
  message: "This chat's agent stopped and could not be restarted. Retry, or start a new chat."
}

// A resume refused this way met a lease someone else is settling — not proof it cannot resume.
const TRANSIENT_RESUME_REFUSALS: ReadonlySet<string> = new Set([
  'execution_owner_reconciling',
  'agent_session_conflict',
  'agent_session_checkpoint_stale',
  'agent_session_ownership_unknown',
  'agent_session_operation_capacity'
])

/** Why the record refuses any send right now, whoever owns it; null when a send may run. */
export function structuredAgentSessionSendBlock(
  record: AgentSessionRecord | null
): { ok: false; refusal: AgentSessionWireRefusal } | null {
  const rewind = record?.rewind
  if (rewind?.phase === 'prepared' || rewind?.phase === 'provider-succeeded') {
    return rewindRefusal('outcome-unknown')
  }
  const command = record?.conversationCommand
  if (
    command &&
    ((command.state === 'unknown' && command.phase === 'prepared') ||
      (command.command === 'clear' && command.replacementSessionId))
  ) {
    return {
      ok: false,
      refusal: {
        code: 'agent_session_operation_invalid',
        message: command.replacementSessionId
          ? 'This conversation has been cleared. Use the current conversation.'
          : 'The conversation operation is unconfirmed.'
      }
    }
  }
  return null
}

/** Whether this send is the one that must bring the owner back: no child, a lease handed back
 *  cleanly, and nothing on the record that refuses the send anyway. Live, unverifiable, still
 *  reserved, or handed off: that lease is not this send's to replace. */
export function structuredAgentSessionSendNeedsOwner(
  session: StructuredAgentSessionHostSession | undefined,
  record: AgentSessionRecord
): boolean {
  return (
    session?.hasProviderChild !== true &&
    isResumableStructuredAgentSessionRecord(record) &&
    structuredAgentSessionSendBlock(record) === null
  )
}

export async function prepareStructuredAgentSessionSend(
  context: Pick<
    StructuredAgentSessionMutationContext,
    'deps' | 'sessions' | 'holds' | 'restoreReadable'
  >,
  envelope: AgentSessionMutationEnvelope,
  ledger: 'admit' | 'replay',
  record: AgentSessionRecord
): Promise<AgentSessionMutationSessionPreparation> {
  const { sessionId } = record
  if (ledger !== 'admit') {
    if (!context.sessions.has(sessionId)) {
      await context.restoreReadable(sessionId)
    }
    return { ok: true, envelope }
  }
  if (structuredAgentSessionSendNeedsOwner(context.sessions.get(sessionId), record)) {
    try {
      await context.holds.ensureProviderChild(sessionId)
    } catch (error) {
      if (!(error instanceof Error && TRANSIENT_RESUME_REFUSALS.has(error.message))) {
        context.deps.onEventSinkError?.({ sessionId, error })
        return { ok: false, refusal: AGENT_SESSION_OWNER_UNRECOVERABLE }
      }
    }
  }
  return { ok: true, envelope: admitAtResumedFence(context.sessions.get(sessionId), envelope) }
}

/** A writer current as of the owner this child replaced is current now: the restart was the only
 *  thing that moved the fence, whether this send ran it or one just ahead of it did. */
function admitAtResumedFence(
  session: StructuredAgentSessionHostSession | undefined,
  envelope: AgentSessionMutationEnvelope
): AgentSessionMutationEnvelope {
  return session?.hasProviderChild &&
    session.resumedFromFence !== undefined &&
    envelope.expectedRuntimeFence === session.resumedFromFence
    ? { ...envelope, expectedRuntimeFence: session.fence }
    : envelope
}
