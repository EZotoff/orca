// Every provider's lifecycle events share one recovery chain in the runtime. A Claude child
// proving its start must not make that chain, or the session's own serialized operations,
// wait on the CLI: the host records what the child proved from what the adapter already holds.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaudeStreamJsonConnection,
  ClaudeStreamJsonConnectionHandlers,
  openClaudeStreamJsonConnection
} from '../claude/claude-stream-json-connection'
import { claudeSessionIdForOrcaSession } from '../claude/claude-structured-launch-resolution'
import { hostTestAttachParams } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime,
  waitForStructuredAgentSessionRecovery
} from './structured-agent-session-runtime'

const STALLED = 'claude-started-stalled'
const HEALTHY = 'claude-started-healthy'
const CALLER = { callerKey: 'client-1' }

type ScriptedClaude = {
  sessionId: string
  calls: string[]
  handlers: ClaudeStreamJsonConnectionHandlers
  connection: Omit<ClaudeStreamJsonConnection, 'closed' | 'exitVerdict'> & {
    closed: boolean
    exitVerdict: ClaudeStreamJsonConnection['exitVerdict']
  }
}

let root: string | null = null
let operations = 0
// The runtime's own clock admits operation ids, so these are minted against it.
const operationId = (): string => `${Date.now()}-${(++operations).toString(16).padStart(32, '0')}`
let releaseStall: () => void = () => {}

afterEach(async () => {
  releaseStall()
  await stopStructuredAgentSessionRuntime()
  if (root) {
    await rm(root, { recursive: true, force: true })
    root = null
  }
})

/** A CLI that answers startup, then never answers another control read for `stalledSessionId`. */
function scriptedClaude(stalledSessionId: string) {
  const children: ScriptedClaude[] = []
  let release = (): void => {}
  const stall = new Promise<void>((resolve) => {
    release = resolve
  })
  const answer = <T>(child: ScriptedClaude, value: T, startup: boolean): Promise<T> =>
    child.sessionId === stalledSessionId && !startup
      ? stall.then(() => value)
      : Promise.resolve(value)
  const openConnection: typeof openClaudeStreamJsonConnection = async (launch, handlers = {}) => {
    const providerSessionId = String(launch.options.sessionId ?? launch.options.resume)
    const sessionId = [STALLED, HEALTHY].find(
      (candidate) => claudeSessionIdForOrcaSession(candidate) === providerSessionId
    )!
    let settingsReads = 0
    const child: ScriptedClaude = {
      sessionId,
      calls: [],
      handlers,
      connection: {
        pid: 5000 + children.length,
        closed: false,
        exitVerdict: { root: 'live', tree: 'unverifiable' },
        initializationResult: async () => {
          handlers.onMessage?.({
            type: 'system',
            subtype: 'init',
            session_id: providerSessionId,
            model: 'claude-sonnet-5',
            apiKeySource: 'none'
          })
          return { models: [{ value: 'sonnet', displayName: 'Sonnet' }] }
        },
        getSettings: () => {
          child.calls.push('get_settings')
          settingsReads += 1
          return answer(child, { effective: { effortLevel: 'high' } }, settingsReads === 1)
        },
        supportedModels: () => {
          child.calls.push('list_models')
          return answer(child, [{ value: 'sonnet', displayName: 'Sonnet' }], false)
        },
        setModel: async () => {},
        setPermissionMode: async () => {},
        applyFlagSettings: async () => {},
        interrupt: async () => undefined,
        cancelAsyncMessage: async () => {},
        stopTask: async () => {},
        send: async () => {},
        close: async () => {
          child.connection.closed = true
          return true
        }
      }
    }
    children.push(child)
    return child.connection
  }
  const child = (sessionId: string): ScriptedClaude => {
    const found = children.findLast((entry) => entry.sessionId === sessionId)
    if (!found) {
      throw new Error(`no Claude child for ${sessionId}`)
    }
    return found
  }
  return { openConnection, child, release: () => release() }
}

function claudeParams(sessionId: string) {
  return hostTestAttachParams(null, {
    envelope: {
      sessionId,
      clientOperationId: operationId(),
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    provider: 'claude',
    agent: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(root!, 'claude-home') },
    providerHandle: {
      kind: 'claude',
      sessionId: claudeSessionIdForOrcaSession(sessionId),
      leafUuid: null
    }
  })
}

async function install(
  claude: ReturnType<typeof scriptedClaude>
): Promise<StructuredAgentSessionHost> {
  root = await mkdtemp(join(tmpdir(), 'orca-runtime-provider-started-'))
  await mkdir(join(root, 'claude-home'), { recursive: true })
  return ensureStructuredAgentSessionHost({
    stateDirectory: root,
    hostId: 'local',
    claimKeyId: 'key-1',
    resolveWorkspacePath: async () => root!,
    resolveClaudeCommand: () => '/usr/local/bin/claude',
    resolveClaudeAuthPolicy: () => ({ stripAuthEnv: false }),
    openClaudeConnection: claude.openConnection,
    readProcessStartTime: async (pid: number) => pid * 10
  })
}

describe('a Claude child proving its start', () => {
  it("never holds another session's exit recovery, or its own close, on a CLI read", async () => {
    const claude = scriptedClaude(STALLED)
    releaseStall = claude.release
    const host = await install(claude)

    const first = await host.attach(CALLER, claudeParams(HEALTHY))
    expect(first, JSON.stringify(first)).toMatchObject({ ok: true })
    await waitForStructuredAgentSessionRecovery()

    // This child answers startup, then never answers another control read.
    await expect(host.attach(CALLER, claudeParams(STALLED))).resolves.toMatchObject({ ok: true })
    await vi.waitFor(() => expect(claude.child(STALLED).calls).toContain('get_settings'))
    // Its `started` reaches the shared chain ahead of the exit below.
    await new Promise((resolve) => setImmediate(resolve))

    const healthy = claude.child(HEALTHY)
    healthy.connection.exitVerdict = { root: 'exited', tree: 'unverifiable' }
    healthy.handlers.onExit?.(new Error('claude stream-json exited (code 1): crashed'))
    await vi.waitFor(() =>
      expect(host.deps.store.getRecord(HEALTHY)?.lease.claimStatus).toBe('released')
    )

    // What the child proved is still recorded, from the startup it already answered.
    await vi.waitFor(() =>
      expect(host.deps.store.getRecord(STALLED)?.options).toEqual({
        model: 'claude-sonnet-5',
        effort: 'high'
      })
    )
    expect(claude.child(STALLED).calls).toEqual(['get_settings'])

    let closed = false
    void host.close(STALLED).then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(closed).toBe(true))
  })
})
