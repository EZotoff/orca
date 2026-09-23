import { attachStructuredAgentSessionUnderSerialize } from './structured-agent-session-attach-orchestration'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { StructuredAgentSessionLifecycleEvent } from './structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import type { StructuredAgentSessionSinkBarrier } from './structured-agent-session-event-sink'
import { resumeHeldStructuredAgentSession } from './structured-agent-session-hold-resume'
import { settleStructuredAgentSessionProviderStarted } from './structured-agent-session-provider-started'
import {
  isStructuredAgentSessionRecoveryTicketCurrent,
  settleUnexpectedStructuredAgentSessionExit
} from './structured-agent-session-unexpected-exit'

export class StructuredAgentSessionEventRecovery {
  private readonly sinkFailures = new Set<string>()

  constructor(
    private readonly context: {
      deps: StructuredAgentSessionHostDeps
      store: StructuredAgentSessionHostDeps['store']
      sessions: Map<string, StructuredAgentSessionHostSession>
      flushLifecycle: (sessionId: string) => Promise<StructuredAgentSessionSinkBarrier>
      publishFence: (sessionId: string, session: StructuredAgentSessionHostSession) => void
      publishStatus?: (sessionId: string) => void
      hasResumeCapableHolder: (sessionId: string) => boolean
      serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
      now: () => number
      attachContext: () => StructuredAgentSessionAttachContext
      onBarrierError: (sessionId: string, error: unknown) => void
    }
  ) {}

  recoverAfterSinkFailure(sessionId: string, error: unknown): void {
    if (this.sinkFailures.has(sessionId)) {
      return
    }
    this.sinkFailures.add(sessionId)
    void this.context
      .serialize(sessionId, async () => {
        const session = this.context.sessions.get(sessionId)
        const stop =
          this.context.deps.adapter.forceCloseSession ?? this.context.deps.adapter.closeSession
        if (!session?.hasProviderChild || !stop) {
          return null
        }
        const fence = session.fence
        const acquisitionGeneration = session.acquisitionGeneration
        const stopped = await stop(sessionId)
        if (!stopped || !acquisitionGeneration) {
          return null
        }
        return {
          type: 'ended',
          sessionId,
          reason: `journal sink failure: ${error instanceof Error ? error.message : String(error)}`,
          cause: 'unexpected-exit',
          fence,
          acquisitionGeneration
        } as const
      })
      .then((event) => (event ? this.handle(event) : undefined))
      .catch((recoveryError) => this.context.onBarrierError(sessionId, recoveryError))
      .finally(() => this.sinkFailures.delete(sessionId))
  }

  async handle(event: StructuredAgentSessionLifecycleEvent): Promise<void> {
    if (event.type === 'started') {
      return settleStructuredAgentSessionProviderStarted(this.context, event)
    }
    const ticket = await settleUnexpectedStructuredAgentSessionExit(this.context, event)
    if (!ticket) {
      return
    }
    // One serialized step with the ticket check inside it: a hold or a send that got there first
    // has already replaced the owner, and this attach then refuses on the stale ticket rather than
    // spawning a second child against the fence it moved.
    try {
      await this.context.serialize(ticket.sessionId, () => {
        const attachContext = this.context.attachContext()
        return resumeHeldStructuredAgentSession({
          sessionId: ticket.sessionId,
          context: attachContext,
          attach: (params) =>
            attachStructuredAgentSessionUnderSerialize(
              attachContext,
              'trusted-local:provider-exit-recovery',
              params,
              {
                admitRecoveryTicket: () =>
                  isStructuredAgentSessionRecoveryTicketCurrent(this.context, ticket)
              }
            )
        })
      })
    } catch (error) {
      if (isStructuredAgentSessionRecoveryTicketCurrent(this.context, ticket)) {
        this.context.onBarrierError(ticket.sessionId, error)
      }
    }
  }
}
