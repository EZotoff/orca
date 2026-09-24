// Service + persistence battery for the identity bridge (Task 13). Fakes for
// the hook/inventory seams; a real temp dir for the Orca-owned state file.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type {
  HookCorrelation,
  HookCorrelationSource,
  LiveInventory,
  LiveInventorySource,
  LiveTerminalHandle
} from '../../shared/identity-bridge-types'
import { IdentityBridge } from './identity-bridge'
import { IdentityBridgeStore } from './identity-bridge-store'

const LEAF_A = '11111111-1111-4111-8111-111111111111'

const terminal = (overrides: Partial<LiveTerminalHandle> = {}): LiveTerminalHandle => ({
  executionHostId: 'local',
  worktreeIdentity: 'wt2:local:inst-1',
  tabId: 'tab-1',
  leafId: LEAF_A,
  terminalHandle: 'term-1',
  ...overrides
})

const correlation = (overrides: Partial<HookCorrelation> = {}): HookCorrelation => ({
  executionHostId: 'local',
  tabId: 'tab-1',
  leafId: LEAF_A,
  launchToken: 'tok-1',
  sessionID: 'ses-1',
  canonicalRoot: '/repo',
  ...overrides
})

class FakeInventory implements LiveInventorySource {
  inventory: LiveInventory = { terminals: [terminal()], connectedHosts: ['local'] }
  async listInventory(): Promise<LiveInventory> {
    return this.inventory
  }
}

class FakeCorrelations implements HookCorrelationSource {
  correlations: HookCorrelation[] = [correlation()]
  async listCorrelations(): Promise<readonly HookCorrelation[]> {
    return this.correlations
  }
}

describe('IdentityBridge', () => {
  let dir: string
  let path: string
  let inventory: FakeInventory
  let correlations: FakeCorrelations
  let now: number

  const makeBridge = () =>
    new IdentityBridge({
      store: new IdentityBridgeStore(path),
      inventory,
      correlations,
      now: () => now
    })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'identity-bridge-'))
    path = join(dir, 'identity-bridge.json')
    inventory = new FakeInventory()
    correlations = new FakeCorrelations()
    now = 1_760_000_000_000
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('loads empty when the state file is missing', async () => {
    correlations.correlations = []
    const bridge = makeBridge()
    await bridge.load()
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toBeNull()
  })

  test('recordCorrelation persists a verified mapping that resolve returns', async () => {
    const bridge = makeBridge()
    const record = await bridge.recordCorrelation(correlation())
    expect(record).toMatchObject({ sessionID: 'ses-1', revision: 1, lifecycle: 'active' })
    const resolved = await bridge.resolve({
      executionHostId: 'local',
      canonicalRoot: '/repo',
      sessionID: 'ses-1'
    })
    expect(resolved).toMatchObject({
      leafId: LEAF_A,
      terminalHandle: 'term-1',
      launchToken: 'tok-1'
    })
  })

  test('resolve returns null when no hook correlation exists (pre-Task 16)', async () => {
    correlations.correlations = []
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toBeNull()
  })

  test('reconcile persists and bumps revision on a verified mapping', async () => {
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    now += 5_000
    const result = await bridge.reconcile()
    expect(result.rejected).toEqual([])
    expect(result.verified[0]).toMatchObject({ revision: 2, lastSeenAt: now })
  })

  test('releaseByTerminal marks the mapping released and resolve stops returning it', async () => {
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    await bridge.releaseByTerminal('term-1')
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toBeNull()
  })

  test('a replayed correlation cannot reactivate a released mapping', async () => {
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    await bridge.releaseByTerminal('term-1')
    expect(await bridge.recordCorrelation(correlation())).toBeNull()
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toBeNull()
  })

  test('a new launch correlation rebinds a released session', async () => {
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    await bridge.releaseByTerminal('term-1')
    inventory.inventory = {
      terminals: [terminal({ terminalHandle: 'term-2', launchToken: 'tok-2' })],
      connectedHosts: ['local']
    }
    correlations.correlations = [correlation({ launchToken: 'tok-2' })]
    expect(await bridge.recordCorrelation(correlation({ launchToken: 'tok-2' }))).toMatchObject({
      lifecycle: 'active'
    })
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toMatchObject({ terminalHandle: 'term-2' })
  })

  test('a duplicate live terminal on the same leaf cannot be selected by inventory order', async () => {
    inventory.inventory = {
      terminals: [terminal(), terminal({ terminalHandle: 'second' })],
      connectedHosts: ['local']
    }
    const bridge = makeBridge()
    expect(await bridge.recordCorrelation(correlation())).toBeNull()
  })

  test('same leaf on a second host cannot adopt a local correlation', async () => {
    inventory.inventory = {
      terminals: [terminal({ executionHostId: 'ssh:box', terminalHandle: 'remote' })],
      connectedHosts: ['local', 'ssh:box']
    }
    const bridge = makeBridge()
    expect(await bridge.recordCorrelation(correlation())).toBeNull()
    expect(
      await bridge.resolve({
        executionHostId: 'ssh:box',
        canonicalRoot: '/repo',
        sessionID: 'ses-1'
      })
    ).toBeNull()
  })

  test('a disconnected remote host retains its mapping without resolving', async () => {
    inventory.inventory = {
      terminals: [terminal({ executionHostId: 'ssh:box' })],
      connectedHosts: ['ssh:box']
    }
    correlations.correlations = [correlation({ executionHostId: 'ssh:box' })]
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlations.correlations[0])
    inventory.inventory = { terminals: [], connectedHosts: ['local'] }
    expect(
      await bridge.resolve({
        executionHostId: 'ssh:box',
        canonicalRoot: '/repo',
        sessionID: 'ses-1'
      })
    ).toBeNull()
    expect((await bridge.reconcile()).verified).toMatchObject([{ lifecycle: 'stale' }])
  })

  test('pruneReleased drops released mappings past retention', async () => {
    const bridge = makeBridge()
    await bridge.recordCorrelation(correlation())
    await bridge.releaseByTerminal('term-1')
    now += 60_000
    expect(await bridge.pruneReleased(30_000)).toBe(1)
    expect(await bridge.pruneReleased(30_000)).toBe(0)
  })

  test('restart: a fresh bridge loads persisted state and resolves', async () => {
    const first = makeBridge()
    await first.recordCorrelation(correlation())
    const second = makeBridge()
    const resolved = await second.resolve({
      executionHostId: 'local',
      canonicalRoot: '/repo',
      sessionID: 'ses-1'
    })
    expect(resolved).toMatchObject({ leafId: LEAF_A, revision: 2 })
  })

  test('a corrupt state file loads as empty rather than poisoning resolution', async () => {
    correlations.correlations = []
    await writeFile(path, '{ not json', 'utf8')
    const bridge = makeBridge()
    await bridge.load()
    expect(
      await bridge.resolve({ executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-1' })
    ).toBeNull()
  })
})
