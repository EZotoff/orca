// A Claude chat is published the moment its child spawns, before the CLI has answered initialize.
// A send in that window — into a fresh start, or into the restart a send itself asked for after
// a start that failed — is admitted only once the child has proven its start. When the CLI dies
// first, the send is refused with the CLI's own diagnostic, the chat shows it once, and nothing
// is left as a delivery nobody can confirm. Against the production runtime, adapter, record
// store and host, with only the CLI process scripted.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import { hostTestMessage } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { waitForStructuredAgentSessionRecovery } from './structured-agent-session-runtime'
import { createScriptedClaudeRuntime } from './structured-claude-scripted-runtime-test-support'

const SESSION = 'claude-send-waits'
const CALLER = { callerKey: 'client-1' }
const DIAGNOSTIC = 'claude stream-json exited (code 1): claude: not signed in (rig)'

let claude = createScriptedClaudeRuntime([SESSION])
let operations = 0

afterEach(async () => {
  await claude.dispose()
  claude = createScriptedClaudeRuntime([SESSION])
})

function send(host: StructuredAgentSessionHost, text: string) {
  const body = hostTestMessage(text)
  return host.send(CALLER, {
    envelope: {
      sessionId: SESSION,
      clientOperationId: `${Date.now()}-${(++operations).toString(16).padStart(32, '0')}`,
      expectedRuntimeFence: fence(host),
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: SESSION,
        fields: { body }
      })
    },
    body
  })
}

function fence(host: StructuredAgentSessionHost): number {
  return host.deps.store.getRecord(SESSION)?.lease.runtimeFence ?? 0
}

function statusRows(host: StructuredAgentSessionHost): string[] {
  return host
    .journalSnapshot(SESSION)
    .items.flatMap((item) => (item.body.kind === 'status' ? [item.body.text] : []))
}

/** The send's serialized step has run and left it waiting, off the queue, on the child's start. */
function sendIsWaitingOnStartup(host: StructuredAgentSessionHost): Promise<void> {
  return vi.waitFor(() => expect(host['runtimeState'].startup['waiters'].has(SESSION)).toBe(true))
}

/** The CLI keeps dying at startup: the latest child exits with the diagnostic once it exists. */
async function failLatestStart(host: StructuredAgentSessionHost, count: number): Promise<void> {
  await vi.waitFor(() => expect(claude.children(SESSION)).toHaveLength(count))
  claude.child(SESSION).exit(new Error(DIAGNOSTIC))
  await waitForStructuredAgentSessionRecovery()
  await vi.waitFor(() =>
    expect(host.deps.store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
  )
}

describe('a send into a Claude chat whose CLI keeps failing at startup', () => {
  it('restarts once, is refused with the diagnostic when that start dies too, then delivers once the CLI is healthy', async () => {
    claude.behave(SESSION, { initHangs: true })
    const host = await claude.install()
    await expect(host.attach(CALLER, claude.attachParams(SESSION, null))).resolves.toMatchObject({
      ok: true
    })
    await failLatestStart(host, 1)
    expect(statusRows(host)).toEqual([expect.stringContaining('not signed in')])
    const releasedFence = fence(host)

    // The send asks for the child back; the CLI dies again before it answers initialize.
    const sent = send(host, 'hello?')
    await sendIsWaitingOnStartup(host)
    await failLatestStart(host, 2)

    const refused = await sent
    expect(refused, JSON.stringify(refused)).toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_owner_unrecoverable',
        message: `This chat's agent could not be restarted: ${DIAGNOSTIC}. Retry, or start a new chat.`,
        ownerVerdict: 'exited'
      }
    })
    // Not admitted, so not a delivery in doubt; one row for this attempt names the cause.
    expect(host.journalSnapshot(SESSION).submissions).toEqual([])
    expect(statusRows(host)).toEqual([
      expect.stringContaining('not signed in'),
      expect.stringMatching(/stopped before it finished starting: .*not signed in \(rig\)/)
    ])
    // The restart moved the fence twice: its acquisition, and the exit that released it.
    expect(fence(host)).toBe(releasedFence + 2)
    expect(claude.children(SESSION)).toHaveLength(2)

    // The user signs in and retries: one restart, proven, delivered.
    claude.behave(SESSION, {})
    const delivered = await send(host, 'hello again')
    expect(delivered, JSON.stringify(delivered)).toMatchObject({ ok: true, replayed: false })
    expect(claude.children(SESSION)).toHaveLength(3)
    expect(fence(host)).toBe(releasedFence + 3)
    await vi.waitFor(() =>
      expect(host.deps.store.getRecord(SESSION)?.lease.claimStatus).toBe('live')
    )
  })
})

describe('a send while the first Claude start is still answering initialize', () => {
  it('waits, and is admitted once the CLI proves its start', async () => {
    claude.behave(SESSION, { initHangs: true })
    const host = await claude.install()
    await host.attach(CALLER, claude.attachParams(SESSION, null))

    const sent = send(host, 'hello')
    await sendIsWaitingOnStartup(host)

    // The CLI answers: startup lands and the waiting send is admitted against the proven child.
    claude.child(SESSION).answerInit()

    await expect(sent).resolves.toMatchObject({ ok: true, replayed: false })
    expect(claude.children(SESSION)).toHaveLength(1)
  })

  it('is refused with the diagnostic when the CLI dies first, and restarts nothing', async () => {
    claude.behave(SESSION, { initHangs: true })
    const host = await claude.install()
    await host.attach(CALLER, claude.attachParams(SESSION, null))
    const startedFence = fence(host)

    const sent = send(host, 'hello')
    await sendIsWaitingOnStartup(host)
    await failLatestStart(host, 1)

    await expect(sent).resolves.toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_owner_unrecoverable',
        message: expect.stringContaining('not signed in (rig)'),
        ownerVerdict: 'exited'
      }
    })
    expect(host.journalSnapshot(SESSION).submissions).toEqual([])
    expect(statusRows(host)).toEqual([
      expect.stringMatching(/stopped before it finished starting: .*not signed in \(rig\)/)
    ])
    expect(fence(host)).toBe(startedFence + 1)
    expect(claude.children(SESSION)).toHaveLength(1)
  })
})
