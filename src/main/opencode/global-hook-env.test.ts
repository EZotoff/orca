import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GLOBAL_HOOK_ENV_ALLOWLIST,
  buildGlobalHookChildEnv,
  createGlobalHookIdentityToken,
  hashGlobalHookIdentityToken,
  isValidGlobalHookIdentityToken,
  revokedGlobalHookTokensFileName,
  revokeGlobalHookIdentityToken,
  stripOrcaHookEnv
} from './global-hook-env'
import {
  GLOBAL_HOOK_IDENTITY_TOKEN_ENV,
  GLOBAL_HOOK_STATE_DIR_ENV
} from './global-hook-plugin-source'
import { globalHookPathsFor, provisionGlobalHookChildEnv } from './global-hook-startup'

describe('global-hook identity token contract', () => {
  it('accepts only the documented orca1.<random> shape', () => {
    expect(isValidGlobalHookIdentityToken(createGlobalHookIdentityToken())).toBe(true)
    const invalid: unknown[] = [
      undefined,
      null,
      42,
      '',
      'orca1.',
      'orca1.short',
      'notorca1.' + 'a'.repeat(64),
      'orca1.' + 'a'.repeat(31),
      'orca1.' + 'a'.repeat(513),
      'orca1.' + 'a'.repeat(31) + '!',
      'orca1.' + 'a'.repeat(31) + ' '
    ]
    for (const value of invalid) {
      expect(isValidGlobalHookIdentityToken(value), String(value)).toBe(false)
    }
  })

  it('creates unguessable, unique, single-purpose tokens (never an API key)', () => {
    const a = createGlobalHookIdentityToken()
    const b = createGlobalHookIdentityToken()

    expect(a).not.toBe(b)
    expect(a.startsWith('orca1.')).toBe(true)
    // 32 random bytes base64url — high entropy, not a provider key.
    expect(a.slice('orca1.'.length).length).toBeGreaterThanOrEqual(43)
  })

  it('hashes deterministically to a 64-char hex digest', () => {
    const token = createGlobalHookIdentityToken()
    const digest = hashGlobalHookIdentityToken(token)

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(hashGlobalHookIdentityToken(token)).toBe(digest)
    expect(hashGlobalHookIdentityToken(createGlobalHookIdentityToken())).not.toBe(digest)
  })

  it('documents exactly the two allowed Orca vars', () => {
    expect([...GLOBAL_HOOK_ENV_ALLOWLIST].sort()).toEqual(
      [GLOBAL_HOOK_IDENTITY_TOKEN_ENV, GLOBAL_HOOK_STATE_DIR_ENV].sort()
    )
  })
})

describe('stripOrcaHookEnv allow-list semantics', () => {
  it('removes every non-allow-listed ORCA_* var and keeps everything else', () => {
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin',
      HOME: '/home/operator',
      OPENCODE_CONFIG_DIR: '/home/operator/.config/opencode',
      OMO_ENABLE: '1',
      ORCA_AGENT_HOOK_PORT: '1',
      ORCA_AGENT_HOOK_TOKEN: 'agent-hook-secret',
      ORCA_AGENT_HOOK_ENDPOINT: '/tmp/orca.sock',
      ORCA_AGENT_HOOK_TRANSPORT: 'unix',
      ORCA_AGENT_HOOK_VERSION: '3',
      ORCA_AGENT_HOOK_ENV: 'prod',
      ORCA_OPENCODE_CONFIG_DIR: '/tmp/overlay',
      ORCA_OPENCODE_SOURCE_CONFIG_DIR: '/tmp/source',
      ORCA_ENABLE_GLOBAL_HOOK_INSTALL: '1',
      ORCA_USER_DATA_PATH: '/home/operator/.config/Orca',
      ORCA_CODEX_HOME: '/home/operator/.codex',
      ORCA_MIMOCODE_HOME: '/home/operator/.mimocode',
      ORCA_CLAUDE_AGENT_STATUS_SETTINGS: '/tmp/settings.json',
      ORCA_HOOK_STATE_DIR: '/state',
      ORCA_HOOK_IDENTITY_TOKEN: createGlobalHookIdentityToken(),
      EMPTY: undefined
    }

    const out = stripOrcaHookEnv(env)

    expect(Object.keys(out).filter((key) => key.startsWith('ORCA_')).sort()).toEqual(
      [GLOBAL_HOOK_IDENTITY_TOKEN_ENV, GLOBAL_HOOK_STATE_DIR_ENV].sort()
    )
    expect(out.PATH).toBe('/usr/bin')
    expect(out.HOME).toBe('/home/operator')
    expect(out.OPENCODE_CONFIG_DIR).toBe('/home/operator/.config/opencode')
    expect(out.OMO_ENABLE).toBe('1')
    expect('EMPTY' in out).toBe(false)
    for (const leaked of [
      'ORCA_AGENT_HOOK_TOKEN',
      'ORCA_AGENT_HOOK_ENDPOINT',
      'ORCA_ENABLE_GLOBAL_HOOK_INSTALL',
      'ORCA_OPENCODE_CONFIG_DIR'
    ]) {
      expect(out, leaked).not.toHaveProperty(leaked)
    }
  })
})

describe('buildGlobalHookChildEnv', () => {
  const stateDir = '/home/operator/.config/Orca/opencode-global-hook'

  it('carries only the two documented identity vars plus the non-Orca env', () => {
    const parentEnv: Record<string, string | undefined> = {
      PATH: '/usr/bin',
      ORCA_AGENT_HOOK_TOKEN: 'leak-me',
      ORCA_ENABLE_GLOBAL_HOOK_INSTALL: '1'
    }
    const token = createGlobalHookIdentityToken()

    const env = buildGlobalHookChildEnv(parentEnv, { stateDir, identityToken: token })

    expect(env[GLOBAL_HOOK_STATE_DIR_ENV]).toBe(stateDir)
    expect(env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]).toBe(token)
    expect(env.PATH).toBe('/usr/bin')
    expect(env).not.toHaveProperty('ORCA_AGENT_HOOK_TOKEN')
    expect(env).not.toHaveProperty('ORCA_ENABLE_GLOBAL_HOOK_INSTALL')
  })

  it('replaces an inherited identity with the fresh per-PTY identity', () => {
    const parentEnv: Record<string, string | undefined> = {
      [GLOBAL_HOOK_STATE_DIR_ENV]: '/stale/state',
      [GLOBAL_HOOK_IDENTITY_TOKEN_ENV]: createGlobalHookIdentityToken()
    }
    const fresh = createGlobalHookIdentityToken()

    const env = buildGlobalHookChildEnv(parentEnv, { stateDir, identityToken: fresh })

    expect(env[GLOBAL_HOOK_STATE_DIR_ENV]).toBe(stateDir)
    expect(env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]).toBe(fresh)
  })

  it('rejects malformed provisioning instead of shipping partial identity', () => {
    const token = createGlobalHookIdentityToken()
    for (const badStateDir of ['relative/path', '/tmp/../escape', '']) {
      expect(() =>
        buildGlobalHookChildEnv({}, { stateDir: badStateDir, identityToken: token })
      ).toThrow('invalid global-hook state dir provisioning')
    }
    for (const badToken of ['', 'nope', 'orca1.short', 'orca1.' + 'x'.repeat(513)]) {
      expect(() =>
        buildGlobalHookChildEnv({}, { stateDir, identityToken: badToken })
      ).toThrow('invalid global-hook identity token provisioning')
    }
  })
})

describe('revokeGlobalHookIdentityToken', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'orca-hook-revoke-'))
  })

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('appends the token hash (never the token) and is idempotent', async () => {
    const token = createGlobalHookIdentityToken()

    await revokeGlobalHookIdentityToken({ stateDir, token })
    await revokeGlobalHookIdentityToken({ stateDir, token })

    const raw = readFileSync(join(stateDir, revokedGlobalHookTokensFileName()), 'utf8')
    expect(raw).not.toContain(token)
    const digests = JSON.parse(raw) as string[]
    expect(digests).toEqual([hashGlobalHookIdentityToken(token)])
  })

  it('creates the state dir when absent', async () => {
    const nested = join(stateDir, 'nested', 'state')
    const token = createGlobalHookIdentityToken()

    await revokeGlobalHookIdentityToken({ stateDir: nested, token })

    expect(JSON.parse(readFileSync(join(nested, revokedGlobalHookTokensFileName()), 'utf8'))).toEqual(
      [hashGlobalHookIdentityToken(token)]
    )
  })
})

describe('provisionGlobalHookChildEnv (startup seam)', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-hook-provision-'))
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('derives the state dir from userData and mints a fresh token per call', () => {
    const userDataDir = join(homeDir, '.config', 'Orca')
    const first = provisionGlobalHookChildEnv({
      parentEnv: { PATH: '/usr/bin', ORCA_AGENT_HOOK_TOKEN: 'leak' },
      homeDir,
      userDataDir
    })
    const second = provisionGlobalHookChildEnv({
      parentEnv: { PATH: '/usr/bin' },
      homeDir,
      userDataDir
    })

    const { stateDir } = globalHookPathsFor(homeDir, userDataDir)
    expect(first.env[GLOBAL_HOOK_STATE_DIR_ENV]).toBe(stateDir)
    expect(first.identityToken).not.toBe(second.identityToken)
    expect(first.env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV]).toBe(first.identityToken)
    expect(isValidGlobalHookIdentityToken(first.identityToken)).toBe(true)
    expect(first.env).not.toHaveProperty('ORCA_AGENT_HOOK_TOKEN')
  })

  it('never lets an OMO/OpenCode-style parent env smuggle an Orca identity', () => {
    const userDataDir = join(homeDir, '.config', 'Orca')
    const { env } = provisionGlobalHookChildEnv({
      parentEnv: {
        OPENCODE_CONFIG_DIR: '/home/operator/.config/opencode',
        OMO_ENABLE: '1',
        ORCA_HOOK_STATE_DIR: '/attacker/controlled',
        ORCA_HOOK_IDENTITY_TOKEN: 'orca1.' + 'a'.repeat(64)
      },
      homeDir,
      userDataDir
    })

    const { stateDir } = globalHookPathsFor(homeDir, userDataDir)
    expect(env[GLOBAL_HOOK_STATE_DIR_ENV]).toBe(stateDir)
    expect(env[GLOBAL_HOOK_STATE_DIR_ENV]).not.toBe('/attacker/controlled')
  })
})

describe('startup paths', () => {
  it('keeps the state dir outside the OpenCode discovery glob', () => {
    const { pluginsDir, stateDir } = globalHookPathsFor('/home/operator', '/home/operator/.config/Orca')
    expect(stateDir.startsWith(pluginsDir)).toBe(false)
  })
})
