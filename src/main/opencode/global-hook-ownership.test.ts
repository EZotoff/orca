import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GLOBAL_HOOK_CONSUMERS_FILE,
  createProcfsProcessIdentityReader,
  type ProcessIdentityReader
} from './global-hook-consumer-registry'
import {
  installGlobalOpenCodeHook,
  GLOBAL_HOOK_PLUGIN_FILE,
  uninstallGlobalOpenCodeHook,
  type GlobalHookPaths
} from './global-hook-installer'
import {
  registerGlobalHookConsumer,
  reconcileGlobalHookConsumers,
  releaseGlobalHookConsumer,
  uninstallGlobalOpenCodeHookOwnershipChecked
} from './global-hook-ownership'
import { createGlobalHookIdentityToken } from './global-hook-env'

const FIXED_NOW = new Date('2026-09-24T05:06:07.890Z')
const BOOT_A = 'b1111111-2222-3333-4444-555555555555'
const BOOT_B = 'cccccccc-2222-3333-4444-555555555555'

type Sandbox = {
  readonly pluginsDir: string
  readonly stateDir: string
}

function makeSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), 'orca-hook-ownership-'))
  const pluginsDir = join(home, '.config', 'opencode', 'plugins')
  const stateDir = join(home, '.config', 'orca', 'opencode-global-hook')
  return { pluginsDir, stateDir }
}

function pathsOf(sandbox: Sandbox): GlobalHookPaths {
  return { pluginsDir: sandbox.pluginsDir, stateDir: sandbox.stateDir }
}

function pluginPathOf(sandbox: Sandbox): string {
  return join(sandbox.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
}

function registryPathOf(sandbox: Sandbox): string {
  return join(sandbox.stateDir, GLOBAL_HOOK_CONSUMERS_FILE)
}

/**
 * Fake pid seam: startTimes maps pid → current start time; a pid absent from the
 * map is "no such process". Never touches real processes.
 */
function fakeReader(startTimes: Record<number, string>, bootId: string | null = BOOT_A): ProcessIdentityReader {
  return {
    async bootId() {
      return bootId
    },
    async pidStartTime(pid: number) {
      return startTimes[pid] ?? null
    }
  }
}

function writeRegistryRaw(sandbox: Sandbox, raw: string): void {
  mkdirSync(sandbox.stateDir, { recursive: true })
  writeFileSync(registryPathOf(sandbox), raw)
}

function token(): string {
  return createGlobalHookIdentityToken()
}

async function registerLive(
  sandbox: Sandbox,
  startTimes: Record<number, string>,
  consumerId: string,
  pid: number,
  identityToken = token()
): Promise<void> {
  const outcome = await registerGlobalHookConsumer({
    paths: pathsOf(sandbox),
    reader: fakeReader(startTimes),
    now: () => FIXED_NOW,
    consumer: { consumerId, pid, identityToken }
  })
  expect(outcome).toEqual({ status: 'registered', record: expect.objectContaining({ consumerId, pid }) })
}

describe('global hook consumer ownership registry', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists one durable record per consumer, outside the plugin discovery glob', async () => {
    const startTimes = { 4242: '11100' }
    await registerLive(sandbox, startTimes, 'wt2:host:i1#pty-1', 4242, 'orca1.'.padEnd(40, 'a'))
    const raw = JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8'))
    expect(raw.schemaVersion).toBe(1)
    expect(raw.consumers).toHaveLength(1)
    const record = raw.consumers[0]
    expect(record.consumerId).toBe('wt2:host:i1#pty-1')
    expect(record.pid).toBe(4242)
    expect(record.bootId).toBe(BOOT_A)
    expect(record.pidStartTime).toBe('11100')
    expect(record.installGeneration).toBe(1)
    expect(record.identityTokenSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(record.identityTokenSha256).not.toContain('orca1')
    // Registry lives in the state dir, never in the plugins dir.
    expect(readdirSync(sandbox.pluginsDir)).not.toContain(GLOBAL_HOOK_CONSUMERS_FILE)
  })

  it('concurrent consumers coexist: a second instance JOINS, never deletes the first record', async () => {
    const startTimes = { 100: '1', 200: '2', 300: '3' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    await registerLive(sandbox, startTimes, 'consumer-b', 200)
    await registerLive(sandbox, startTimes, 'consumer-c', 300)
    const raw = JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8'))
    expect(raw.consumers.map((c: { consumerId: string }) => c.consumerId).sort()).toEqual([
      'consumer-a',
      'consumer-b',
      'consumer-c'
    ])
  })

  it('re-registering the same consumerId upserts instead of duplicating', async () => {
    const startTimes = { 100: '1', 1000: '10' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    await registerLive(sandbox, startTimes, 'consumer-a', 1000)
    const raw = JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8'))
    expect(raw.consumers).toHaveLength(1)
    expect(raw.consumers[0].pid).toBe(1000)
  })

  it('rejects malformed registration input at the boundary', async () => {
    await expect(
      registerGlobalHookConsumer({
        paths: pathsOf(sandbox),
        reader: fakeReader({ 1: '1' }),
        consumer: { consumerId: 'bad id!', pid: 1, identityToken: token() }
      })
    ).rejects.toThrow('consumer id')
    await expect(
      registerGlobalHookConsumer({
        paths: pathsOf(sandbox),
        reader: fakeReader({ 0: '1' }),
        consumer: { consumerId: 'ok-id', pid: 0, identityToken: token() }
      })
    ).rejects.toThrow('pid')
    await expect(
      registerGlobalHookConsumer({
        paths: pathsOf(sandbox),
        reader: fakeReader({ 1: '1' }),
        consumer: { consumerId: 'ok-id', pid: 1, identityToken: 'not-a-token' }
      })
    ).rejects.toThrow('token')
    expect(existsSync(registryPathOf(sandbox))).toBe(false)
  })

  it('refuses registration when the identity seam cannot capture pid identity', async () => {
    const outcome = await registerGlobalHookConsumer({
      paths: pathsOf(sandbox),
      reader: fakeReader({}, null),
      consumer: { consumerId: 'consumer-a', pid: 100, identityToken: token() }
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'identity-unreadable' })
    expect(existsSync(registryPathOf(sandbox))).toBe(false)
  })

  it('refuses registration over a corrupt registry without overwriting it', async () => {
    writeRegistryRaw(sandbox, '{ not json')
    const outcome = await registerGlobalHookConsumer({
      paths: pathsOf(sandbox),
      reader: fakeReader({ 100: '1' }),
      consumer: { consumerId: 'consumer-a', pid: 100, identityToken: token() }
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'state-corrupt' })
    expect(readFileSync(registryPathOf(sandbox), 'utf8')).toBe('{ not json')
  })
})

describe('stale-record GC (reconcile)', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  it('prunes records for dead pids and rewrites the registry', async () => {
    const startTimes = { 100: '1', 999: '42' }
    await registerLive(sandbox, startTimes, 'alive', 100)
    await registerLive(sandbox, startTimes, 'dead', 999)
    const reconciled = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader({ 100: '1' }) // pid 999 has exited
    })
    expect(reconciled.status).toBe('ok')
    expect(reconciled.pruned.map((r) => r.consumerId)).toEqual(['dead'])
    expect(reconciled.live.map((r) => r.consumerId)).toEqual(['alive'])
    const raw = JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8'))
    expect(raw.consumers.map((c: { consumerId: string }) => c.consumerId)).toEqual(['alive'])
  })

  it('PID reuse: a recycled pid with a different start time never inherits ownership', async () => {
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'original', 100)
    // pid 100 exits; pid 100 is recycled with a fresh start time.
    const recycled = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader({ 100: '999999' })
    })
    expect(recycled.status).toBe('ok')
    expect(recycled.live).toEqual([])
    expect(recycled.pruned.map((r) => r.consumerId)).toEqual(['original'])
  })

  it('a boot-id change (reboot) prunes every record', async () => {
    const startTimes = { 100: '1', 200: '2' }
    await registerLive(sandbox, startTimes, 'a', 100)
    await registerLive(sandbox, startTimes, 'b', 200)
    const afterReboot = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader(startTimes, BOOT_B)
    })
    expect(afterReboot.status).toBe('ok')
    expect(afterReboot.live).toEqual([])
    expect(afterReboot.pruned).toHaveLength(2)
  })

  it('procfs unavailable ⇒ nothing is pruned (unknown counts as still dependent)', async () => {
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'a', 100)
    const reconciled = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader({}, null)
    })
    expect(reconciled.status).toBe('ok')
    expect(reconciled.live.map((r) => r.consumerId)).toEqual(['a'])
    expect(reconciled.pruned).toEqual([])
  })

  it('reports a corrupt registry without throwing and without rewriting it', async () => {
    writeRegistryRaw(sandbox, '[]')
    const reconciled = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader({})
    })
    expect(reconciled.status).toBe('corrupt')
    expect(readFileSync(registryPathOf(sandbox), 'utf8')).toBe('[]')
  })

  it('reports a missing registry as missing (no file is created)', async () => {
    const reconciled = await reconcileGlobalHookConsumers({
      paths: pathsOf(sandbox),
      reader: fakeReader({})
    })
    expect(reconciled.status).toBe('missing')
    expect(existsSync(registryPathOf(sandbox))).toBe(false)
  })
})

describe('consumer release', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  it('refuses release while the exact process is still live', async () => {
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    const outcome = await releaseGlobalHookConsumer({
      paths: pathsOf(sandbox),
      reader: fakeReader(startTimes),
      consumerId: 'consumer-a'
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'still-live' })
    expect(JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8')).consumers).toHaveLength(1)
  })

  it('releases after the process exits and keeps other consumers', async () => {
    const startTimes = { 100: '1', 200: '2' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    await registerLive(sandbox, startTimes, 'consumer-b', 200)
    const outcome = await releaseGlobalHookConsumer({
      paths: pathsOf(sandbox),
      reader: fakeReader({ 200: '2' }),
      consumerId: 'consumer-a'
    })
    expect(outcome).toEqual({ status: 'released' })
    expect(JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8')).consumers.map(
      (c: { consumerId: string }) => c.consumerId
    )).toEqual(['consumer-b'])
  })

  it('unknown consumer and unknown identity are conservative refusals', async () => {
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    expect(
      await releaseGlobalHookConsumer({ paths: pathsOf(sandbox), reader: fakeReader(startTimes), consumerId: 'nope' })
    ).toEqual({ status: 'unknown-consumer' })
    expect(
      await releaseGlobalHookConsumer({ paths: pathsOf(sandbox), reader: fakeReader({}, null), consumerId: 'consumer-a' })
    ).toEqual({ status: 'refused', reason: 'identity-unknown' })
  })
})

describe('ownership-checked uninstall', () => {
  let sandbox: Sandbox

  beforeEach(() => {
    sandbox = makeSandbox()
  })

  async function installPlugin(): Promise<void> {
    const outcome = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })
    expect(['installed', 'noop']).toContain(outcome.status)
  }

  it('refuses while any live owned consumer exists; the plugin stays in place', async () => {
    await installPlugin()
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader(startTimes),
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'owned-consumers-live', liveCount: 1 })
    expect(existsSync(pluginPathOf(sandbox))).toBe(true)
  })

  it('after the last consumer exits, GC prunes and the uninstall removes the plugin', async () => {
    await installPlugin()
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}), // consumer's pid is gone
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'removed' })
    expect(existsSync(pluginPathOf(sandbox))).toBe(false)
    expect(JSON.parse(readFileSync(registryPathOf(sandbox), 'utf8')).consumers).toEqual([])
  })

  it('after the last consumer exits via pid recycling, uninstall still removes the plugin', async () => {
    await installPlugin()
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    const refused = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader(startTimes),
      now: () => FIXED_NOW
    })
    expect(refused.status).toBe('refused')
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({ 100: 'recycled' }), // pid reuse ⇒ record is dead
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'removed' })
    expect(existsSync(pluginPathOf(sandbox))).toBe(false)
  })

  it('corrupt state file: refuses uninstall (no auto-uninstall) even though GC sees zero consumers', async () => {
    await installPlugin()
    writeRegistryRaw(sandbox, 'garbage')
    expect(
      await reconcileGlobalHookConsumers({ paths: pathsOf(sandbox), reader: fakeReader({}) })
    ).toEqual({ status: 'corrupt', live: [], pruned: [] })
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}),
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'state-corrupt' })
    expect(existsSync(pluginPathOf(sandbox))).toBe(true)
  })

  it('missing state file with the plugin present: conservative refusal', async () => {
    await installPlugin()
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}),
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'refused', reason: 'state-missing' })
    expect(existsSync(pluginPathOf(sandbox))).toBe(true)
  })

  it('force bypasses the live-consumer refusal, logged loudly and recorded', async () => {
    await installPlugin()
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader(startTimes),
      now: () => FIXED_NOW,
      force: true
    })
    expect(outcome).toEqual({ status: 'removed' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('FORCED uninstall')
    const recorded = JSON.parse(readFileSync(join(sandbox.stateDir, 'last-install-outcome.json'), 'utf8'))
    expect(recorded.outcome.reason).toBe('forced')
  })

  it('force bypasses a corrupt registry refusal, logged loudly', async () => {
    await installPlugin()
    writeRegistryRaw(sandbox, 'garbage')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}),
      now: () => FIXED_NOW,
      force: true
    })
    expect(outcome).toEqual({ status: 'removed' })
    expect(warn.mock.calls[0][0]).toContain('FORCED uninstall')
  })

  it('absent plugin: reports absent without touching state', async () => {
    const outcome = await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}),
      now: () => FIXED_NOW
    })
    expect(outcome).toEqual({ status: 'absent' })
  })

  it('G3 zero-writes: register + reconcile + checked uninstall stay inside pluginsDir/stateDir', async () => {
    const home = join(sandbox.pluginsDir, '..', '..', '..')
    await installPlugin()
    const startTimes = { 100: '1' }
    await registerLive(sandbox, startTimes, 'consumer-a', 100)
    await reconcileGlobalHookConsumers({ paths: pathsOf(sandbox), reader: fakeReader({}) })
    await uninstallGlobalOpenCodeHookOwnershipChecked({
      paths: pathsOf(sandbox),
      reader: fakeReader({}),
      now: () => FIXED_NOW
    })
    const allowed = (path: string): boolean =>
      path.startsWith(`${sandbox.pluginsDir}/`) || path.startsWith(`${sandbox.stateDir}/`)
    expect(allowed(registryPathOf(sandbox))).toBe(true)
    // The sandbox home contains only the dirs we created — assert no stray top-level entries.
    for (const entry of readdirSync(home)) {
      expect(allowed(join(home, entry)) || entry === '.config').toBe(true)
    }
  })
})

describe('real procfs seam (read-only /proc access)', () => {
  it('reads the real boot id and this process start time; nonexistent pids read as null', async () => {
    const reader = createProcfsProcessIdentityReader()
    const bootId = await reader.bootId()
    expect(bootId).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    const startTime = await reader.pidStartTime(process.pid)
    expect(startTime).toMatch(/^\d+$/)
    expect(await reader.pidStartTime(4_194_303)).toBeNull()
  })
})

describe('Task 16 regressions stay intact', () => {
  it('plain install/uninstall (no ownership wiring) behaves exactly as before', async () => {
    const sandbox = makeSandbox()
    const installed = await installGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })
    expect(installed.status).toBe('installed')
    const outcome = await uninstallGlobalOpenCodeHook({ paths: pathsOf(sandbox), now: () => FIXED_NOW })
    expect(outcome).toEqual({ status: 'removed' })
  })
})
