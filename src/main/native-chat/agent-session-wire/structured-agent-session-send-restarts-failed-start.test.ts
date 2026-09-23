// A session that published and then lost its child before startup (not signed in, say) keeps a
// released lease and a chat the user can still type into. The send is the user asking for the
// child back: the host restarts it before admitting the write and delivers against the new owner,
// instead of parking the message behind a lease nothing would ever re-acquire.
//
// A child is published before it has proven its start, so the send waits for that proof before it
// is admitted: admitted once the child is `ready`, refused with the child's own reason when it
// exits first. Nothing here ever dispatches into a child that may be about to die.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  hostTestMessage,
  hostTestOperationId,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'

const CALLER = { callerKey: 'client-1' }
const EXIT_REASON = 'Claude Code is not signed in. Sign in with the Claude CLI'

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>
let hostErrors: unknown[]
let generation = 0

function sendEnvelope(
  fence: number,
  body: ReturnType<typeof hostTestMessage>
): AgentSessionMutationEnvelope {
  return {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: fence,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method: 'agentSession.send',
      sessionId: SESSION,
      fields: { body }
    })
  }
}

function send(text: string, fence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0) {
  const body = hostTestMessage(text)
  return host.send(CALLER, { envelope: sendEnvelope(fence, body), body })
}

/** The child of the current acquisition, as the adapter would identify it in a lifecycle event. */
function currentChild() {
  return {
    sessionId: SESSION,
    fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 0,
    acquisitionGeneration: `generation-${generation}`
  }
}

function proveStarted(): Promise<void> {
  return host.handleAdapterEvent({
    type: 'started',
    ...currentChild(),
    reportedOptions: { model: 'sonnet' },
    restoreSkippedOptions: []
  })
}

function exitBeforeProof(): Promise<void> {
  return host.handleAdapterEvent({
    type: 'ended',
    ...currentChild(),
    reason: EXIT_REASON,
    cause: 'unexpected-exit',
    startupUnproven: true
  })
}

/** The send's serialized step has run and left it waiting, off the queue, on the child's start. */
function sendIsWaitingOnStartup(): Promise<void> {
  return vi.waitFor(() => expect(host['runtimeState'].startup['waiters'].has(SESSION)).toBe(true))
}

function journalStatuses(): string[] {
  return host
    .journalSnapshot(SESSION)
    .items.flatMap((item) => (item.body.kind === 'status' ? [item.body.text] : []))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-send-after-failed-start-'))
  resetHostTestOperationIds()
  generation = 0
  hostErrors = []
  acquire = vi.fn(async ({ fence, spawnToken }) => ({
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    link: {
      linkId: `link-${fence}`,
      handle: { provider: 'codex', threadId: THREAD },
      // A re-acquire resumes the thread the first child minted, as a real adapter does.
      origin: generation === 0 ? ('created' as const) : ('resumed' as const),
      mintedAtFence: fence,
      observedAt: NOW
    },
    acquisitionGeneration: `generation-${++generation}`,
    providerChildPhase: 'starting' as const
  }))
  dispatch = vi.fn(async () => ({ state: 'admitted' as const }))
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  host = new StructuredAgentSessionHost({
    store,
    adapter: {
      acquire,
      releaseAcquisition: vi.fn(async () => true),
      closeSession: vi.fn(async () => true),
      dispatch,
      cancelTurn: vi.fn(async () => ({ cancelled: true })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${generation + 1}`,
    now: () => NOW,
    onEventSinkError: ({ error }) => hostErrors.push(error)
  })
  await expect(host.attach(CALLER, hostTestAttachParams(null))).resolves.toMatchObject({
    ok: true
  })
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  await rm(root, { recursive: true, force: true })
})

describe('a send into a published session whose child ended before startup', () => {
  beforeEach(async () => {
    await exitBeforeProof()
    // The failed start released the lease and no resume ran on its own.
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('restarts the child, waits for it to prove its start, then delivers against it', async () => {
    const releasedFence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0

    const first = send('hello again', releasedFence)
    await sendIsWaitingOnStartup()
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('live')
    // Restarted, but not admitted: the child has proven nothing yet.
    expect(dispatch).not.toHaveBeenCalled()

    await proveStarted()

    // The client was current as of the lost owner, so the send is rebased onto the fence the
    // resume published and admitted once, with no stale round trip.
    await expect(first).resolves.toMatchObject({
      ok: true,
      replayed: false,
      value: { submission: { dispatchState: 'pending' } }
    })
    expect(dispatch).toHaveBeenCalledOnce()
    const current = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    expect(current).toBeGreaterThan(releasedFence)

    // The next send meets a live, proven owner and restarts nothing.
    await expect(send('and again', current)).resolves.toMatchObject({
      ok: true,
      value: { submission: { dispatchState: 'pending' } }
    })
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('refuses with the cause when the restarted child exits before proving its start', async () => {
    const releasedFence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    const rowsBefore = journalStatuses().length

    const sent = send('still not signed in', releasedFence)
    await sendIsWaitingOnStartup()
    await exitBeforeProof()

    await expect(sent).resolves.toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_owner_unrecoverable',
        message: `This chat's agent could not be restarted: ${EXIT_REASON}. Retry, or start a new chat.`,
        ownerVerdict: 'exited'
      }
    })
    // Never dispatched, so never left in doubt; one row in the chat names the cause.
    expect(dispatch).not.toHaveBeenCalled()
    expect(journalSnapshotSubmissions()).toEqual([])
    expect(journalStatuses().slice(rowsBefore)).toEqual([
      expect.stringMatching(/stopped before it finished starting: .*not signed in/)
    ])
    expect(hostErrors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining(EXIT_REASON) })
    )
    // The failed restart moved the fence twice: the acquisition, and the exit that released it.
    expect(store.getRecord(SESSION)?.lease.runtimeFence).toBe(releasedFence + 2)
    expect(store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
    // One spawn per user action: nothing restarted it a second time.
    expect(acquire).toHaveBeenCalledTimes(2)

    // Retry is a fresh action: it restarts once and, once proven, is delivered.
    const retried = send('signed in now')
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(3))
    await proveStarted()
    await expect(retried).resolves.toMatchObject({ ok: true })
    expect(dispatch).toHaveBeenCalledOnce()
  })

  function journalSnapshotSubmissions() {
    return host.journalSnapshot(SESSION).submissions
  }
})

describe('a send while the child of the first start is still proving itself', () => {
  it('waits, and is admitted once the child proves its start', async () => {
    const sent = send('hello')

    await sendIsWaitingOnStartup()
    expect(dispatch).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()

    await proveStarted()

    await expect(sent).resolves.toMatchObject({
      ok: true,
      value: { submission: { dispatchState: 'pending' } }
    })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('is refused with the cause when that child exits first, and restarts nothing', async () => {
    const fence = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    const sent = send('hello')
    await sendIsWaitingOnStartup()

    await exitBeforeProof()

    await expect(sent).resolves.toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_owner_unrecoverable',
        message: expect.stringContaining(EXIT_REASON),
        ownerVerdict: 'exited'
      }
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
    expect(journalStatuses()).toEqual([
      expect.stringMatching(/stopped before it finished starting: .*not signed in/)
    ])
    expect(store.getRecord(SESSION)?.lease.runtimeFence).toBe(fence + 1)
  })

  it('answers retryably, and spawns nothing, when the session is closed under it', async () => {
    const sent = send('hello')
    await sendIsWaitingOnStartup()

    await host.close(SESSION)

    await expect(sent).resolves.toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_ownership_unknown' }
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it('leaves a send against a proven child alone', async () => {
    await proveStarted()

    await expect(send('hello')).resolves.toMatchObject({ ok: true })

    expect(acquire).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledOnce()
  })
})
