// A structured-session runtime whose Claude children are scripted: the production runtime,
// adapter, record store and host, with only the CLI process replaced.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ClaudeStreamJsonConnection,
  ClaudeStreamJsonConnectionHandlers,
  ClaudeStreamJsonLaunch,
  openClaudeStreamJsonConnection
} from '../claude/claude-stream-json-connection'
import { claudeSessionIdForOrcaSession } from '../claude/claude-structured-launch-resolution'
import { hostTestAttachParams } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

export type ScriptedClaudeBehavior = {
  /** Initialize never answers; only the child's exit settles it. */
  initHangs?: boolean
  /** Every control read after startup's own settings read waits for `releaseStalls`. */
  stallsControlReads?: boolean
}

export type ScriptedClaudeChild = {
  sessionId: string
  launch: ClaudeStreamJsonLaunch
  calls: string[]
  handlers: ClaudeStreamJsonConnectionHandlers
  connection: Omit<ClaudeStreamJsonConnection, 'closed' | 'exitVerdict'> & {
    closed: boolean
    exitVerdict: ClaudeStreamJsonConnection['exitVerdict']
  }
  /** The CLI exits on its own: its root is gone, its tree unverifiable. */
  exit: (error: Error) => void
}

export function createScriptedClaudeRuntime(sessionIds: readonly string[]) {
  const children: ScriptedClaudeChild[] = []
  const behaviors = new Map<string, ScriptedClaudeBehavior>()
  let releaseStalls = (): void => {}
  const stall = new Promise<void>((resolve) => {
    releaseStalls = resolve
  })
  let root: string | null = null
  let operations = 0

  const openConnection: typeof openClaudeStreamJsonConnection = async (launch, handlers = {}) => {
    const providerSessionId = String(launch.options.sessionId ?? launch.options.resume)
    const sessionId = sessionIds.find(
      (candidate) => claudeSessionIdForOrcaSession(candidate) === providerSessionId
    )
    if (!sessionId) {
      throw new Error(`no scripted Claude session for ${providerSessionId}`)
    }
    const behavior = behaviors.get(sessionId) ?? {}
    let failInit = (_error: Error): void => {}
    const answer = <T>(value: T, startup: boolean): Promise<T> =>
      behavior.stallsControlReads && !startup ? stall.then(() => value) : Promise.resolve(value)
    let settingsReads = 0
    const child: ScriptedClaudeChild = {
      sessionId,
      launch,
      calls: [],
      handlers,
      exit: (error) => {
        child.connection.exitVerdict = { root: 'exited', tree: 'unverifiable' }
        failInit(error)
        handlers.onExit?.(error)
      },
      connection: {
        pid: 5000 + children.length,
        closed: false,
        exitVerdict: { root: 'live', tree: 'unverifiable' },
        initializationResult: () => {
          if (behavior.initHangs) {
            return new Promise((_resolve, reject) => {
              failInit = reject
            })
          }
          handlers.onMessage?.({
            type: 'system',
            subtype: 'init',
            session_id: providerSessionId,
            model: 'claude-sonnet-5',
            apiKeySource: 'none'
          })
          return Promise.resolve({ models: [{ value: 'sonnet', displayName: 'Sonnet' }] })
        },
        getSettings: () => {
          child.calls.push('get_settings')
          settingsReads += 1
          return answer({ effective: { effortLevel: 'high' } }, settingsReads === 1)
        },
        supportedModels: () => {
          child.calls.push('list_models')
          return answer([{ value: 'sonnet', displayName: 'Sonnet' }], false)
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

  return {
    behave: (sessionId: string, behavior: ScriptedClaudeBehavior): void => {
      behaviors.set(sessionId, behavior)
    },
    /** The latest child spawned for `sessionId`. */
    child: (sessionId: string): ScriptedClaudeChild => {
      const found = children.findLast((entry) => entry.sessionId === sessionId)
      if (!found) {
        throw new Error(`no Claude child for ${sessionId}`)
      }
      return found
    },
    children: (sessionId: string): ScriptedClaudeChild[] =>
      children.filter((entry) => entry.sessionId === sessionId),
    install: async (): Promise<StructuredAgentSessionHost> => {
      root = await mkdtemp(join(tmpdir(), 'orca-scripted-claude-runtime-'))
      await mkdir(join(root, 'claude-home'), { recursive: true })
      const directory = root
      return ensureStructuredAgentSessionHost({
        stateDirectory: directory,
        hostId: 'local',
        claimKeyId: 'key-1',
        resolveWorkspacePath: async () => directory,
        resolveClaudeCommand: () => '/usr/local/bin/claude',
        resolveClaudeAuthPolicy: () => ({ stripAuthEnv: false }),
        openClaudeConnection: openConnection,
        readProcessStartTime: async (pid: number) => pid * 10
      })
    },
    attachParams: (sessionId: string, expectedRuntimeFence: number | null) =>
      hostTestAttachParams(expectedRuntimeFence, {
        envelope: {
          sessionId,
          // The runtime's own clock admits operation ids, so these are minted against it.
          clientOperationId: `${Date.now()}-${(++operations).toString(16).padStart(32, '0')}`,
          expectedRuntimeFence,
          payloadFingerprint: ''
        },
        provider: 'claude',
        agent: 'claude',
        accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: join(root ?? '', 'claude-home') },
        providerHandle: {
          kind: 'claude',
          sessionId: claudeSessionIdForOrcaSession(sessionId),
          leafUuid: null
        }
      }),
    dispose: async (): Promise<void> => {
      releaseStalls()
      await stopStructuredAgentSessionRuntime()
      if (root) {
        await rm(root, { recursive: true, force: true })
        root = null
      }
    }
  }
}
