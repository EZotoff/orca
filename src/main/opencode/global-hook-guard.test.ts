import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  GLOBAL_HOOK_IDENTITY_TOKEN_ENV,
  GLOBAL_HOOK_STATE_DIR_ENV,
  getGlobalHookPluginBody
} from './global-hook-plugin-source'
import {
  createGlobalHookIdentityToken,
  revokeGlobalHookIdentityToken
} from './global-hook-env'

type PluginHooks = {
  event?: (input: { event: unknown }) => Promise<void>
}
type PluginModule = { default: (input: { worktree?: string }) => Promise<PluginHooks> }

const GUARD_REFUSALS_LOG = 'guard-refusals.log'
const REVOKED_TOKENS_FILE = 'revoked-tokens.json'

let moduleDir: string
let sandbox: string
let savedStateDir: string | undefined
let savedToken: string | undefined

beforeEach(() => {
  moduleDir = mkdtempSync(join(tmpdir(), 'orca-hook-guard-mod-'))
  sandbox = mkdtempSync(join(tmpdir(), 'orca-hook-guard-'))
  savedStateDir = process.env[GLOBAL_HOOK_STATE_DIR_ENV]
  savedToken = process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]
  delete process.env[GLOBAL_HOOK_STATE_DIR_ENV]
  delete process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]
})

afterEach(() => {
  if (savedStateDir === undefined) {
    delete process.env[GLOBAL_HOOK_STATE_DIR_ENV]
  } else {
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = savedStateDir
  }
  if (savedToken === undefined) {
    delete process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]
  } else {
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = savedToken
  }
  rmSync(moduleDir, { recursive: true, force: true })
  rmSync(sandbox, { recursive: true, force: true })
})

async function loadPluginBody(): Promise<PluginModule> {
  const pluginPath = join(moduleDir, `body-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(pluginPath, getGlobalHookPluginBody())
  return await import(pathToFileURL(pluginPath).href)
}

function stateDir(): string {
  return join(sandbox, 'state')
}

function refusals(): Array<{ at: string; pid: number; reason: string }> {
  const logPath = join(stateDir(), GUARD_REFUSALS_LOG)
  if (!existsSync(logPath)) {
    return []
  }
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { at: string; pid: number; reason: string })
}

describe('global hook guard — foreign-env inertness', () => {
  it('registers nothing and writes nothing when no Orca identity is present', async () => {
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(existsSync(stateDir())).toBe(false)
    expect(existsSync(join(sandbox, 'opencode-sessions'))).toBe(false)
  })

  it('registers nothing when the state dir is present but the token is missing', async () => {
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(existsSync(join(stateDir(), 'opencode-sessions'))).toBe(false)
    expect(refusals().map((entry) => entry.reason)).toEqual(['malformed-identity-token'])
  })

  it('registers nothing when the token is present but the state dir is missing', async () => {
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(existsSync(stateDir())).toBe(false)
  })

  it('is inert for a malformed state dir even with a valid token', async () => {
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    for (const badStateDir of ['relative/path', '/tmp/../escape', '']) {
      process.env[GLOBAL_HOOK_STATE_DIR_ENV] = badStateDir
      await expect(module.default({ worktree: '/wt' })).resolves.toEqual({})
    }
  })

  it('is inert for a garbage token matrix', async () => {
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    const module = await loadPluginBody()
    const garbage = [
      'garbage',
      'orca1.',
      'orca1.short',
      'orca1.' + 'a'.repeat(31),
      'orca1.' + 'a'.repeat(513),
      'orca1.' + 'a'.repeat(31) + '!',
      'notorca1.' + 'a'.repeat(64)
    ]

    for (const token of garbage) {
      process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = token
      await expect(module.default({ worktree: '/wt' }), token).resolves.toEqual({})
    }

    expect(refusals().map((entry) => entry.reason)).toEqual(
      garbage.map(() => 'malformed-identity-token')
    )
  })

  it('is inert for a revoked token', async () => {
    const token = createGlobalHookIdentityToken()
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = token
    await revokeGlobalHookIdentityToken({ stateDir: stateDir(), token })
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(refusals().map((entry) => entry.reason)).toEqual(['revoked-identity-token'])
  })

  it('fails closed when the revocation list is present but corrupt', async () => {
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(join(stateDir(), REVOKED_TOKENS_FILE), '{ not json')
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(refusals().map((entry) => entry.reason)).toEqual(['revocation-list-invalid'])
  })

  it('fails closed when the state dir cannot be used for drops', async () => {
    // A regular file where the state dir should be — mkdir of the drop dir must fail.
    writeFileSync(stateDir(), 'not a directory\n')
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    await expect(module.default({ worktree: '/wt' })).resolves.toEqual({})
    expect(existsSync(join(stateDir(), 'opencode-sessions'))).toBe(false)
  })
})

describe('global hook guard — fail-closed diagnostics', () => {
  it('logs reason + pid but never the token', async () => {
    const token = 'orca1.' + 'a'.repeat(31) + '!'
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = token
    const module = await loadPluginBody()

    await module.default({ worktree: '/wt' })

    const entries = refusals()
    expect(entries).toHaveLength(1)
    expect(entries[0].reason).toBe('malformed-identity-token')
    expect(typeof entries[0].pid).toBe('number')
    expect(Number.isNaN(Date.parse(entries[0].at))).toBe(false)
    expect(readFileSync(join(stateDir(), GUARD_REFUSALS_LOG), 'utf8')).not.toContain(token)
  })

  it('activates with a valid token and records only a non-reversible identity hash', async () => {
    const token = createGlobalHookIdentityToken()
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = token
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/canonical/root' })

    expect(Object.keys(hooks)).toEqual(['event'])
    await hooks.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 'ses_live', projectID: 'p', directory: '/cwd' } }
      }
    })

    const dropPath = join(stateDir(), 'opencode-sessions', 'ses_live.json')
    const raw = readFileSync(dropPath, 'utf8')
    expect(raw).not.toContain(token)
    const drop = JSON.parse(raw) as { identityHash: string; sessionID: string }
    expect(drop.sessionID).toBe('ses_live')
    expect(drop.identityHash).toBe(
      createHash('sha256').update(token).digest('hex').slice(0, 16)
    )
    expect(refusals()).toEqual([])
  })
})

describe('OMO coexistence evidence ladder', () => {
  // Rung (a): plugin present but not Orca-spawned -> inert under an OMO/OpenCode env.
  it('(a) is inert under an OMO-like environment with no Orca identity', async () => {
    process.env.OPENCODE_CONFIG_DIR = join(sandbox, 'opencode-config')
    process.env.OMO_ENABLE = '1'
    process.env.ORCA_AGENT_HOOK_TOKEN = 'agent-hook-secret'
    process.env.ORCA_OPENCODE_CONFIG_DIR = join(sandbox, 'overlay')
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
    expect(existsSync(stateDir())).toBe(false)
    expect(existsSync(join(sandbox, 'opencode-sessions'))).toBe(false)
  })

  // Rung (b): Orca-spawned session coexisting with a sibling plugin -> no collisions.
  it('(b) registers alongside a sibling OMO plugin without handler collisions', async () => {
    const token = createGlobalHookIdentityToken()
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir()
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = token
    const orcaModule = await loadPluginBody()
    const omoEvents: string[] = []
    const omoModule: PluginModule = {
      default: async (): Promise<PluginHooks> => ({
        event: async ({ event }) => {
          omoEvents.push((event as { type: string }).type)
        }
      })
    }

    // Mirrors OpenCode's legacy plugin loader: every export must be a function.
    const registered: PluginHooks[] = []
    for (const mod of [orcaModule, omoModule]) {
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function') {
          throw new Error('Plugin export is not a function')
        }
        registered.push(await value({ worktree: '/wt' }))
      }
    }

    expect(Object.keys(orcaModule)).toEqual(['default'])
    expect(registered).toHaveLength(2)
    const [orcaHooks, omoHooks] = registered
    expect(Object.keys(orcaHooks)).toEqual(['event'])

    const event = {
      type: 'session.created',
      properties: { info: { id: 'ses_coexist', projectID: 'p', directory: '/cwd' } }
    }
    await orcaHooks.event?.({ event })
    await omoHooks.event?.({ event })

    expect(omoEvents).toEqual(['session.created'])
    expect(existsSync(join(stateDir(), 'opencode-sessions', 'ses_coexist.json'))).toBe(true)
  })

  it('(b) leaves a sibling plugin untouched when Orca is inert', async () => {
    const orcaModule = await loadPluginBody()
    const omoEvents: string[] = []
    const omoModule: PluginModule = {
      default: async (): Promise<PluginHooks> => ({
        event: async ({ event }) => {
          omoEvents.push((event as { type: string }).type)
        }
      })
    }

    const orcaHooks = await orcaModule.default({ worktree: '/wt' })
    const omoHooks = await omoModule.default({ worktree: '/wt' })

    expect(orcaHooks).toEqual({})
    await omoHooks.event?.({ event: { type: 'session.idle', properties: {} } })
    expect(omoEvents).toEqual(['session.idle'])
    expect(existsSync(join(sandbox, REVOKED_TOKENS_FILE))).toBe(false)
  })
})
