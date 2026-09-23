// A session interrupted by a quit, then read back by a fresh host on the same profile: the fixture
// the restart suites share, so each reaches the next launch the same way.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import {
  AgentSessionRecoveryCapsule,
  AGENT_SESSION_RECOVERY_CAPSULE_FILE
} from '../../runtime/agent-session-recovery-capsule'
import { parseAgentSessionResumeMarker } from '../../../shared/agent-session-resume-marker'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  adapter,
  attach,
  CALLER,
  envelope,
  hostTestState,
  replaceHostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestMessage
} from './structured-agent-session-host-test-data'

/** The host's release grace in these restarts; tests advance fake timers past it. */
export const GRACE = 15_000

/** A session interrupted by a quit and read back by a fresh host on the same profile. */
export async function interruptedRestart(
  work: 'turn' | 'submission' | 'children' = 'turn',
  historyBoundaryConsistent = true
) {
  const previous = hostTestState()
  await attach()
  const events = previous.acquire.mock.calls[0]?.[0].events
  if (!events) {
    throw new Error('missing provider event sink')
  }
  if (work === 'submission') {
    previous.dispatch.mockResolvedValueOnce({ state: 'admitted' })
    const body = hostTestMessage('Perform the original task')
    await previous.host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
  } else if (work === 'children') {
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'settled-turn', ordinal: 1 },
      { kind: 'turn', turnId: 'settled-turn', state: 'completed' }
    )
    const group = {
      provider: 'codex',
      threadId: THREAD,
      turnId: 'settled-turn',
      ordinal: 2
    } as const
    const roster = (state: 'working' | 'unverifiable') => ({
      kind: 'message' as const,
      role: 'system' as const,
      blocks: [
        {
          type: 'subagent-group' as const,
          groupId: 'settled-turn',
          agents: [{ id: 'child-1', label: 'Review loop 4', state }]
        }
      ]
    })
    events.appendItem(group, roster('working'))
    previous.host.deps.adapter.backgroundTaskState = () => ({
      state: 'monitoring',
      tasks: [{ id: 'child-1', kind: 'agent', description: 'Review loop 4', state: 'working' }]
    })
    // As the real adapters do: the child's own close settles the children it can no longer hear.
    previous.host.deps.adapter.closeSession = async () => {
      events.appendItem(group, roster('unverifiable'))
      return true
    }
  } else {
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'interrupted-turn', ordinal: 1 },
      { kind: 'turn', turnId: 'interrupted-turn', state: 'running' }
    )
  }
  await previous.host.flushStreamedEvents(SESSION)
  await previous.host.flushAllStreamedEvents()
  const store = await AgentSessionRecordStore.open({
    directory: join(previous.root, 'store'),
    hostId: 'local'
  })
  const closeSession = vi.fn(async () => true)
  const host = new StructuredAgentSessionHost({
    store,
    adapter: {
      ...adapter(),
      closeSession,
      ...(work === 'submission'
        ? {
            providerHistoryWindow: async () => ({
              items: [],
              boundaryConsistent: historyBoundaryConsistent,
              turnInFlight: false
            })
          }
        : {})
    },
    journalRoot: previous.root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-next',
    probeOwner: async () => ({ outcome: 'pid-absent' }),
    recoveryCapsule: new AgentSessionRecoveryCapsule(previous.root),
    releaseGraceMs: GRACE,
    now: () => NOW
  })
  replaceHostTestState({ store, host })
  previous.acquire.mockClear()
  previous.releaseAcquisition.mockClear()
  previous.dispatch.mockClear()
  const capsule = JSON.parse(
    await readFile(join(previous.root, AGENT_SESSION_RECOVERY_CAPSULE_FILE), 'utf8')
  )
  const marker = parseAgentSessionResumeMarker(capsule.entries[0]?.marker)
  return { ...hostTestState(), host, store, closeSession, marker }
}

