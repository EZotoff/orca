import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  GLOBAL_HOOK_PLUGIN_FILE,
  installGlobalOpenCodeHook,
  uninstallGlobalOpenCodeHook,
  verifyGlobalOpenCodeHook,
  type GlobalHookPaths
} from './global-hook-installer'
import {
  buildMarkedGlobalHookContent,
  hashGlobalHookBody,
  parseMarkedGlobalHookContent
} from './global-hook-marker'
import { GLOBAL_HOOK_STATE_DIR_ENV, getGlobalHookPluginBody } from './global-hook-plugin-source'
import { GLOBAL_HOOK_IDENTITY_TOKEN_ENV, createGlobalHookIdentityToken } from './global-hook-env'

const FIXED_NOW = new Date('2026-09-24T01:02:03.456Z')

type Sandbox = {
  readonly home: string
  readonly pluginsDir: string
  readonly stateDir: string
  readonly guarded: string[]
}

function makeSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), 'orca-global-hook-'))
  const configDir = join(home, '.config', 'opencode')
  const pluginsDir = join(configDir, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  const guarded = [
    join(configDir, 'opencode.json'),
    join(configDir, 'oh-my-openagent.json'),
    join(configDir, 'opencode.jsonc')
  ]
  for (const path of guarded) {
    writeFileSync(path, `{"sentinel":"${path}"}\n`)
  }
  return { home, pluginsDir, stateDir: join(home, '.config', 'Orca', 'opencode-global-hook'), guarded }
}

function pathsOf(sandbox: Sandbox): GlobalHookPaths {
  return { pluginsDir: sandbox.pluginsDir, stateDir: sandbox.stateDir }
}

function pluginPathOf(sandbox: Sandbox): string {
  return join(sandbox.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
}

function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        out.set(full, createHash('sha256').update(readFileSync(full)).digest('hex'))
      }
    }
  }
  walk(root)
  return out
}

function writeOwnedFile(sandbox: Sandbox, body: string): string {
  const content = buildMarkedGlobalHookContent(body, {
    installerVersion: 1,
    installedAt: FIXED_NOW.toISOString(),
    digest: hashGlobalHookBody(body)
  })
  writeFileSync(pluginPathOf(sandbox), content)
  return content
}

describe('installGlobalOpenCodeHook', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  afterEach(() => {
    rmSync(sandbox.home, { recursive: true, force: true })
  })

  it('installs a marked plugin into an empty plugins dir', async () => {
    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'installed' })
    const content = readFileSync(pluginPathOf(sandbox), 'utf8')
    const parsed = parseMarkedGlobalHookContent(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.marker.digest).toBe(hashGlobalHookBody(getGlobalHookPluginBody()))
    expect(parsed?.marker.installedAt).toBe(FIXED_NOW.toISOString())
    expect(parsed?.body).toBe(getGlobalHookPluginBody())
  })

  it('creates the state dir when it does not exist yet', async () => {
    expect(existsSync(sandbox.stateDir)).toBe(false)

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'installed' })
    expect(existsSync(join(sandbox.stateDir, 'last-install-outcome.json'))).toBe(true)
  })

  it('no-ops when the installed digest already matches the current build', async () => {
    await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })
    const before = readFileSync(pluginPathOf(sandbox), 'utf8')

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'noop' })
    expect(readFileSync(pluginPathOf(sandbox), 'utf8')).toBe(before)
  })

  it('refuses a foreign file and leaves it untouched', async () => {
    const foreign = '// some other plugin\nmodule.exports = {}\n'
    writeFileSync(pluginPathOf(sandbox), foreign)

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'refused', reason: 'foreign-file' })
    expect(readFileSync(pluginPathOf(sandbox), 'utf8')).toBe(foreign)
  })

  it('refuses a symlink', async () => {
    const target = join(sandbox.home, 'elsewhere.js')
    writeFileSync(target, '// target\n')
    symlinkSync(target, pluginPathOf(sandbox))

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'refused', reason: 'symlink' })
    expect(readFileSync(target, 'utf8')).toBe('// target\n')
  })

  it('refuses a directory at the plugin path', async () => {
    mkdirSync(pluginPathOf(sandbox))

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'refused', reason: 'directory' })
    expect(statSync(pluginPathOf(sandbox)).isDirectory()).toBe(true)
  })

  it('refuses a marker whose recorded digest disagrees with the installed body', async () => {
    const content = writeOwnedFile(sandbox, '// original body\n')
    writeFileSync(pluginPathOf(sandbox), `${content}\n// tampered\n`)

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'refused', reason: 'tampered-marker' })
  })

  it('backs up and replaces an owned older version', async () => {
    const oldBody = '// old orca body\n'
    const oldContent = writeOwnedFile(sandbox, oldBody)

    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome.status).toBe('replaced')
    if (outcome.status !== 'replaced') {
      throw new Error('expected replaced')
    }
    expect(readFileSync(outcome.backupPath, 'utf8')).toBe(oldContent)
    expect(statSync(outcome.backupPath).mode & 0o777).toBe(0o600)
    expect(parseMarkedGlobalHookContent(readFileSync(pluginPathOf(sandbox), 'utf8'))?.body).toBe(
      getGlobalHookPluginBody()
    )
  })

  it('serializes concurrent installs under the lock', async () => {
    const outcomes = await Promise.all([
      installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW }),
      installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })
    ])

    const statuses = outcomes.map((outcome) => outcome.status).sort()
    expect(statuses).toEqual(['installed', 'noop'])
    expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('ok')
  })

  it('leaves no torn file when a crash lands between temp-write and rename', async () => {
    let observedAtCrash: string | null = null

    await expect(
      installGlobalOpenCodeHook({
        paths: pathsOf(sandbox),
        now: () => FIXED_NOW,
        crashBetweenTempAndRename: () => {
          observedAtCrash = existsSync(pluginPathOf(sandbox))
            ? readFileSync(pluginPathOf(sandbox), 'utf8')
            : null
          throw new Error('simulated crash')
        }
      })
    ).rejects.toThrow('simulated crash')

    // Rename had not happened yet, so the target was still absent.
    expect(observedAtCrash).toBeNull()
    expect(existsSync(pluginPathOf(sandbox))).toBe(false)
    expect(readdirSync(sandbox.pluginsDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the previous owned version intact when a replacement crashes', async () => {
    const oldContent = writeOwnedFile(sandbox, '// old orca body\n')
    let observedAtCrash: string | null = null

    await expect(
      installGlobalOpenCodeHook({
        paths: pathsOf(sandbox),
        now: () => FIXED_NOW,
        crashBetweenTempAndRename: () => {
          observedAtCrash = readFileSync(pluginPathOf(sandbox), 'utf8')
          throw new Error('simulated crash')
        }
      })
    ).rejects.toThrow('simulated crash')

    expect(observedAtCrash).toBe(oldContent)
    expect(readFileSync(pluginPathOf(sandbox), 'utf8')).toBe(oldContent)
    expect(readdirSync(sandbox.pluginsDir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('writes only inside the plugins dir and its own state dir (G3)', async () => {
    const before = snapshotTree(sandbox.home)

    await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    const after = snapshotTree(sandbox.home)
    const allowed = [sandbox.pluginsDir, sandbox.stateDir]
    const isAllowed = (path: string): boolean => allowed.some((dir) => path.startsWith(`${dir}/`))
    for (const [path, hash] of after) {
      if (before.get(path) !== hash) {
        expect(isAllowed(path), `unexpected write: ${path}`).toBe(true)
      }
    }
    for (const [path, hash] of before) {
      if (after.get(path) !== hash) {
        expect(isAllowed(path), `unexpected change: ${path}`).toBe(true)
      }
    }
    for (const path of sandbox.guarded) {
      expect(readFileSync(path, 'utf8')).toBe(`{"sentinel":"${path}"}\n`)
    }
  })
})

describe('uninstallGlobalOpenCodeHook', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  afterEach(() => {
    rmSync(sandbox.home, { recursive: true, force: true })
  })

  it('removes an owned file when no backup exists', async () => {
    await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    const outcome = await uninstallGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'removed' })
    expect(existsSync(pluginPathOf(sandbox))).toBe(false)
  })

  it('restores the newest backup when one exists', async () => {
    const oldContent = writeOwnedFile(sandbox, '// old orca body\n')
    await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    const outcome = await uninstallGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome.status).toBe('restored')
    expect(readFileSync(pluginPathOf(sandbox), 'utf8')).toBe(oldContent)
    expect(readdirSync(sandbox.pluginsDir).filter((name) => name.includes('.bak-'))).toEqual([])
  })

  it('refuses a foreign file', async () => {
    const foreign = '// foreign\n'
    writeFileSync(pluginPathOf(sandbox), foreign)

    const outcome = await uninstallGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'refused', reason: 'foreign-file' })
    expect(readFileSync(pluginPathOf(sandbox), 'utf8')).toBe(foreign)
  })

  it('reports absent when nothing is installed', async () => {
    const outcome = await uninstallGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    expect(outcome).toEqual({ status: 'absent' })
  })
})

describe('verifyGlobalOpenCodeHook', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  afterEach(() => {
    rmSync(sandbox.home, { recursive: true, force: true })
  })

  it('reports ok after a matching install', async () => {
    await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })

    await expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('ok')
  })

  it('reports missing when absent', async () => {
    await expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('missing')
  })

  it('reports foreign for an unmarked file', async () => {
    writeFileSync(pluginPathOf(sandbox), '// foreign\n')

    await expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('foreign')
  })

  it('reports tampered when the installed body was modified', async () => {
    const content = writeOwnedFile(sandbox, '// original body\n')
    writeFileSync(pluginPathOf(sandbox), `${content}\n// tampered\n`)

    await expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('tampered')
  })

  it('reports outdated when an older owned body is installed', async () => {
    writeOwnedFile(sandbox, '// older orca body\n')

    await expect(verifyGlobalOpenCodeHook({ pluginsDir: sandbox.pluginsDir })).resolves.toBe('outdated')
  })
})

describe('global hook plugin body', () => {
  type PluginHooks = { event?: (input: { event: unknown }) => Promise<void> }
  type PluginModule = { default: (input: { worktree?: string }) => Promise<PluginHooks> }

  let tempDir: string
  let savedStateDir: string | undefined
  let savedToken: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-global-hook-body-'))
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
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function loadPluginBody(): Promise<PluginModule> {
    const pluginPath = join(tempDir, `body-${Math.random().toString(36).slice(2)}.mjs`)
    writeFileSync(pluginPath, getGlobalHookPluginBody())
    return await import(pathToFileURL(pluginPath).href)
  }

  it('exposes only a default function export', async () => {
    const module = await loadPluginBody()

    expect(Object.keys(module)).toEqual(['default'])
    expect(module.default).toBeTypeOf('function')
  })

  it('is inert without the Orca state-dir env', async () => {
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })

    expect(hooks).toEqual({})
  })

  it('is inert for a malformed state-dir env', async () => {
    const module = await loadPluginBody()

    for (const malformed of ['relative/path', '/tmp/../escape', '']) {
      process.env[GLOBAL_HOOK_STATE_DIR_ENV] = malformed
      await expect(module.default({ worktree: '/wt' })).resolves.toEqual({})
    }
  })

  it('drops session identity on session.created when provisioned', async () => {
    const stateDir = join(tempDir, 'state')
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/canonical/root' })
    expect(typeof hooks.event).toBe('function')
    await hooks.event?.({
      event: {
        type: 'session.created',
        properties: {
          info: { id: 'ses_abc', projectID: 'proj_1', directory: '/cwd', title: 'Hello' }
        }
      }
    })

    const drop = JSON.parse(readFileSync(join(stateDir, 'opencode-sessions', 'ses_abc.json'), 'utf8'))
    expect(drop).toMatchObject({
      schemaVersion: 1,
      sessionID: 'ses_abc',
      projectID: 'proj_1',
      directory: '/cwd',
      worktree: '/canonical/root',
      title: 'Hello'
    })
    expect(typeof drop.agentPid).toBe('number')
    expect(typeof drop.reportedAt).toBe('number')
  })

  it('drops session identity on session.updated and records parentID', async () => {
    const stateDir = join(tempDir, 'state')
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })
    await hooks.event?.({
      event: {
        type: 'session.updated',
        properties: { info: { id: 'ses_child', projectID: 'p', directory: '/cwd', parentID: 'ses_root' } }
      }
    })

    const drop = JSON.parse(readFileSync(join(stateDir, 'opencode-sessions', 'ses_child.json'), 'utf8'))
    expect(drop.parentID).toBe('ses_root')
  })

  it('ignores events without a session id', async () => {
    const stateDir = join(tempDir, 'state')
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir
    const module = await loadPluginBody()

    const hooks = await module.default({ worktree: '/wt' })
    await hooks.event?.({ event: { type: 'session.created', properties: { info: {} } } })
    await hooks.event?.({ event: { type: 'session.idle', properties: {} } })

    expect(existsSync(join(stateDir, 'opencode-sessions'))).toBe(false)
  })

  it('fails closed (never throws) when the state dir is unusable', async () => {
    const stateDir = join(tempDir, 'state-as-file')
    writeFileSync(stateDir, 'not a directory\n')
    process.env[GLOBAL_HOOK_STATE_DIR_ENV] = stateDir
    process.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = createGlobalHookIdentityToken()
    const module = await loadPluginBody()

    // An unusable state dir deactivates the plugin instead of degrading to partial activation.
    await expect(module.default({ worktree: '/wt' })).resolves.toEqual({})
  })
})
