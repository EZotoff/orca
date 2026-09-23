// A subagent's work must not re-date the session that spawned it.
//
// The session's recency is its journal clock: the status summary's `updatedAt`, which the
// status row takes as its completion stamp and acknowledgement clock. Subagents write into
// the same journal and keep going after the session's own agent has settled, so every hop
// below is the real one — provider translator, deferred sink, durable journal, status feed.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSessionStatusEvent } from '../../../shared/agent-session-wire'
import { createClaudeJournalTranslator } from '../../claude/claude-structured-journal-translation'
import { publishCodexTurnLifecycle } from '../../codex/codex-structured-journal-translation-turns'
import { CodexSubagentRoster } from '../../codex/codex-subagent-roster'
import { createTrackedJournalOpener } from '../agent-session-journal/journal-store-test-open'
import { createDeferredStructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import { StructuredAgentSessionStatusFeed } from './structured-agent-session-status-feed'
import { indexedStatusFeedSession } from './structured-agent-session-status-feed-test-session'

const SESSION = 'recency-session'
const CODEX_THREAD = 'thread-parent'
const CODEX_CHILD = 'thread-child'

let root: string
const journals = createTrackedJournalOpener()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-subagent-recency-'))
})

afterEach(async () => {
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

/** A journal, a feed over it, and a sink that publishes into the feed. One clock serves the
 *  journal and every provider event, and it advances on every read: on the wall clock a burst
 *  of appends can share a millisecond, and a `Math.max` over one number moves nothing, so a
 *  contaminated clock would pass. */
async function openSession() {
  let clock = 10_000
  const tick = (): number => (clock += 1_000)
  const journal = await journals.open({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'claude',
      providerHandle: { kind: 'codex', threadId: CODEX_THREAD }
    },
    now: tick,
    journalDir: join(root, SESSION)
  })
  const feed = new StructuredAgentSessionStatusFeed({
    sessions: new Map([[SESSION, indexedStatusFeedSession({ journal, hasProviderChild: true })]]),
    getRecord: () => null,
    now: () => 1
  })
  const events: AgentSessionStatusEvent[] = []
  feed.subscribe({ id: 'list-1', emit: (event) => events.push(event) })
  const deferred = createDeferredStructuredAgentSessionEventSink()
  deferred.bind({ journal, fence: 1, publish: () => feed.publish(SESSION, journal) })
  const drain = async (): Promise<void> => {
    expect(await deferred.drained()).toEqual({ ok: true })
  }
  /** The prompt as the host journals it; provider user frames never become user rows. */
  const prompt = (clientMessageId: string, text: string) =>
    journal.appendItem(
      { provider: 'orca', clientMessageId },
      { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] },
      { fence: 1 }
    )
  const latestStatus = () => {
    const event = events.findLast((candidate) => candidate.type === 'status')
    if (event?.type !== 'status') {
      throw new Error('status publication missing')
    }
    return event.session
  }
  return {
    journal,
    tick,
    sink: deferred.sink,
    events,
    prompt,
    drain,
    latestStatus,
    close: deferred.close
  }
}

function claudeFrame(message: Record<string, unknown>, startsTurn = false) {
  return {
    type: 'message' as const,
    sessionId: SESSION,
    ...(startsTurn ? { startsTurn: true as const } : {}),
    message: { session_id: 'claude-session', ...message }
  }
}

function claudeUserTurn(uuid: string, text: string) {
  return claudeFrame(
    {
      type: 'user',
      uuid,
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text }] }
    },
    true
  )
}

function claudeResult(uuid: string) {
  return claudeFrame({ type: 'result', subtype: 'success', uuid, result: 'ok' })
}

function claudeTask(subtype: string, fields: Record<string, unknown>) {
  return claudeFrame({ type: 'system', subtype, ...fields })
}

describe("a subagent's work and the recency of the session that spawned it", () => {
  it("holds an idle Claude session's clock while its backgrounded subagent reports and finishes", async () => {
    const session = await openSession()
    const translator = createClaudeJournalTranslator({ sink: session.sink })
    const handle = (event: ReturnType<typeof claudeFrame>): void =>
      translator.handle({ ...event, observedAt: session.tick() })
    await session.prompt('prompt-1', 'fan out')
    handle(claudeUserTurn('user-1', 'fan out'))
    handle(
      claudeFrame({
        type: 'assistant',
        uuid: 'assistant-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'delegating' },
            { type: 'tool_use', id: 'toolu_1', name: 'Task', input: { description: 'x' } }
          ]
        }
      })
    )
    handle(
      claudeTask('task_started', {
        task_id: 'task-1',
        tool_use_id: 'toolu_1',
        task_type: 'local_agent',
        description: 'Watch the build',
        is_backgrounded: true
      })
    )
    handle(
      claudeFrame({
        type: 'user',
        uuid: 'user-2',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }]
        }
      })
    )
    handle(claudeResult('result-1'))
    await session.drain()
    const settled = session.latestStatus()
    expect(settled.status).toBe('idle')
    const ownClock = session.journal.lastActivityAt()
    const published = session.events.length
    const sequence = session.journal.cursor().sequence

    // The session's own agent has settled. Its backgrounded child renames itself and then
    // finishes, and each edge revises the session's roster row.
    handle(
      claudeTask('task_updated', { task_id: 'task-1', patch: { description: 'Build watched' } })
    )
    handle(
      claudeTask('task_notification', {
        task_id: 'task-1',
        tool_use_id: 'toolu_1',
        status: 'completed',
        summary: 'green'
      })
    )
    await session.drain()

    // A control, so the holds below are not vacuous: the child's edges DID reach the journal.
    expect(session.journal.cursor().sequence).toBeGreaterThan(sequence)
    expect(session.journal.lastActivityAt()).toBe(ownClock)
    expect(session.events).toHaveLength(published)
    expect(session.latestStatus().updatedAt).toBe(settled.updatedAt)

    // The session's own next turn still moves it.
    await session.prompt('prompt-2', 'thanks')
    handle(claudeUserTurn('user-3', 'thanks'))
    handle(claudeResult('result-2'))
    await session.drain()
    expect(session.journal.lastActivityAt()).toBeGreaterThan(ownClock)
    expect(session.latestStatus().updatedAt).toBeGreaterThan(settled.updatedAt)
    translator.dispose()
    session.close()
  })

  it("holds an idle Codex session's clock while its subagent streams rows and spends tokens", async () => {
    const session = await openSession()
    const roster = new CodexSubagentRoster({
      sink: session.sink,
      primaryThreadId: () => CODEX_THREAD,
      activeTurn: () => 'turn-1'
    })
    await session.prompt('prompt-1', 'fan out')
    const turn = (state: 'running' | 'completed') =>
      publishCodexTurnLifecycle({
        sink: session.sink,
        primaryThreadId: CODEX_THREAD,
        sessionId: SESSION,
        threadId: CODEX_THREAD,
        turnId: 'turn-1',
        state
      })
    turn('running')
    roster.handleTurn({ threadId: CODEX_CHILD, turnId: 'child-turn-1', state: 'working' })
    roster.handleItem({
      threadId: CODEX_THREAD,
      turnId: 'turn-1',
      item: {
        type: 'subAgentActivity',
        id: 'activity-1',
        kind: 'started',
        agentThreadId: CODEX_CHILD,
        agentPath: '/root/review'
      }
    })
    turn('completed')
    await session.drain()
    const settled = session.latestStatus()
    expect(settled.status).toBe('idle')
    const ownClock = session.journal.lastActivityAt()
    const published = session.events.length
    const sequence = session.journal.cursor().sequence

    // The parent's turn is over; its child runs on. Every usage report revises the roster
    // row, and the child's own item carries its linkage — supplied here, because the Codex
    // translator does not stamp child-thread rows yet.
    roster.handleTokenUsage({ threadId: CODEX_CHILD, tokenUsage: { total: { totalTokens: 900 } } })
    session.sink.appendItem(
      { provider: 'codex', threadId: CODEX_CHILD, turnId: 'child-turn-1', ordinal: 0 },
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'reviewing' }] },
      { agentId: CODEX_CHILD, producerKind: 'agent' }
    )
    session.sink.publish()
    await session.drain()

    expect(session.journal.cursor().sequence).toBeGreaterThan(sequence)
    expect(session.journal.lastActivityAt()).toBe(ownClock)
    expect(session.events).toHaveLength(published)
    expect(session.latestStatus().updatedAt).toBe(settled.updatedAt)
    session.close()
  })
})
