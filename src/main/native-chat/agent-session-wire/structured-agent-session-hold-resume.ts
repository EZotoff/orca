// Giving a session its provider child back.
//
// This is the replacement for the startup resume, and the difference is only in WHO asks: the same
// eligibility rule, run when a surface binds, when a send finds the owner gone, or when a child
// exits under an open surface — never when the app launches. It runs inside the session's
// serialize, with the attach it is given, so the eligibility it reads is the one the attach acts
// on. A write-capable hold must fail when acquisition is refused so the surface never mistakes a
// readable journal for a live provider child.

import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import { adapterSupportsRecord } from './structured-agent-session-provider-support'
import {
  structuredAgentSessionResumeOperationId,
  structuredAgentSessionResumeParams
} from './structured-agent-session-resume-eligibility'

export async function resumeHeldStructuredAgentSession(input: {
  sessionId: string
  context: Pick<
    StructuredAgentSessionAttachContext,
    'deps' | 'runtimeState' | 'reconcileLeases' | 'now'
  >
  attach: (
    params: AgentSessionAttachParams
  ) => Promise<AgentSessionMutationResult<AgentSessionAttachResult>>
}): Promise<void> {
  const { sessionId, context } = input
  // The record is read only once this host has adjudicated it and exited any recovery stage a
  // failed attempt latched — a lease left in `manual-recovery` by an unproven exit is one the
  // resolver hands back, and the eligibility below must see it that way.
  const unreconciled = await context.reconcileLeases(sessionId)
  if (unreconciled) {
    throw new Error(unreconciled.code)
  }
  await context.runtimeState.resolveRecovery(sessionId)
  const record = context.deps.store.getRecord(sessionId)
  if (!record) {
    throw new Error('agent_session_identity_required')
  }
  if (!adapterSupportsRecord(context.deps.adapter, record)) {
    throw new Error('structured_agent_session_unsupported')
  }
  const params = structuredAgentSessionResumeParams(
    record,
    structuredAgentSessionResumeOperationId(context.now())
  )
  if (!params) {
    throw new Error(
      record.lease.unreconciled
        ? 'execution_owner_reconciling'
        : record.lease.claimStatus === 'conflicted'
          ? 'agent_session_conflict'
          : 'agent_session_ownership_unknown'
    )
  }
  const attached = await input.attach(params)
  if (!attached.ok) {
    throw new Error(attached.refusal.code)
  }
}
