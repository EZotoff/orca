// Pure reconciliation battery for the session-to-pane identity bridge (Task 13).
// Fakes only: no live Orca, no OpenCode, no fs.
import { describe, expect, test } from 'vitest'
import { reconcileIdentityBridge } from './identity-bridge-reconcile'
import type { ExecutionHostId } from './execution-host'
import type {
  HookCorrelation,
  IdentityBridgeRecord,
  LiveInventory,
  LiveTerminalHandle
} from './identity-bridge-types'

const NOW = 1_760_000_000_000
const LEAF_A = '11111111-1111-4111-8111-111111111111'
const LEAF_B = '22222222-2222-4222-8222-222222222222'

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

const record = (overrides: Partial<IdentityBridgeRecord> = {}): IdentityBridgeRecord => ({
  executionHostId: 'local',
  canonicalRoot: '/repo',
  sessionID: 'ses-1',
  launchToken: 'tok-1',
  worktreeIdentity: 'wt2:local:inst-1',
  tabId: 'tab-1',
  leafId: LEAF_A,
  terminalHandle: 'term-1',
  revision: 3,
  lastSeenAt: NOW - 1000,
  lifecycle: 'active',
  ...overrides
})

const inventory = (
  terminals: LiveTerminalHandle[],
  connectedHosts: readonly ExecutionHostId[] = ['local']
): LiveInventory => ({ terminals, connectedHosts })

const reconcile = (
  records: IdentityBridgeRecord[],
  terminals: LiveTerminalHandle[],
  correlations: HookCorrelation[],
  connectedHosts: readonly ExecutionHostId[] = ['local']
) =>
  reconcileIdentityBridge({
    records,
    inventory: inventory(terminals, connectedHosts),
    correlations,
    now: NOW
  })

describe('reconcileIdentityBridge', () => {
  test('restart: a persisted mapping survives and bumps revision', () => {
    const result = reconcile([record()], [terminal()], [correlation()])
    expect(result.rejected).toEqual([])
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0]).toMatchObject({
      sessionID: 'ses-1',
      revision: 4,
      lastSeenAt: NOW,
      lifecycle: 'active'
    })
  })

  test('concurrent sessions in one root both verify independently', () => {
    const result = reconcile(
      [
        record({ sessionID: 'ses-1', launchToken: 'tok-1' }),
        record({
          sessionID: 'ses-2',
          launchToken: 'tok-2',
          leafId: LEAF_B,
          terminalHandle: 'term-2'
        })
      ],
      [terminal(), terminal({ leafId: LEAF_B, terminalHandle: 'term-2' })],
      [
        correlation({ sessionID: 'ses-1', launchToken: 'tok-1' }),
        correlation({ sessionID: 'ses-2', launchToken: 'tok-2', leafId: LEAF_B })
      ]
    )
    expect(result.rejected).toEqual([])
    expect(result.verified.map((entry) => entry.sessionID).sort()).toEqual(['ses-1', 'ses-2'])
  })

  test('duplicate worktrees on two hosts stay apart via host-qualified keys', () => {
    const result = reconcile(
      [
        record({ executionHostId: 'local' }),
        record({ executionHostId: 'ssh:box', leafId: LEAF_B, terminalHandle: 'term-remote' })
      ],
      [
        terminal(),
        terminal({ executionHostId: 'ssh:box', leafId: LEAF_B, terminalHandle: 'term-remote' })
      ],
      [correlation(), correlation({ executionHostId: 'ssh:box', leafId: LEAF_B })],
      ['local', 'ssh:box']
    )
    expect(result.rejected).toEqual([])
    expect(result.verified).toHaveLength(2)
  })

  test('remote disconnect keeps the mapping as stale, never rejects it', () => {
    const result = reconcile([record({ executionHostId: 'ssh:box' })], [], [], ['local'])
    expect(result.rejected).toEqual([])
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0].lifecycle).toBe('stale')
  })

  test('reattach/rebind: a moved session rebinds only on a verified correlation', () => {
    const result = reconcile(
      [record({ leafId: LEAF_A, terminalHandle: 'term-1' })],
      [terminal({ leafId: LEAF_B, terminalHandle: 'term-2' })],
      [correlation({ leafId: LEAF_B, launchToken: 'tok-2' })]
    )
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['stale-handle'])
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0]).toMatchObject({ leafId: LEAF_B, launchToken: 'tok-2', revision: 1 })
  })

  test('stale handle: a vanished terminal is rejected', () => {
    const result = reconcile([record()], [], [correlation()])
    expect(result.verified).toEqual([])
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['stale-handle'])
  })

  test('host mismatch: a live terminal on another host is rejected', () => {
    const result = reconcile(
      [record({ executionHostId: 'local' })],
      [terminal({ executionHostId: 'ssh:box' })],
      [correlation()],
      ['local', 'ssh:box']
    )
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['host-mismatch'])
  })

  test('reused terminal: a changed launch token is rejected', () => {
    const result = reconcile(
      [record({ launchToken: 'tok-1' })],
      [terminal({ launchToken: 'tok-2' })],
      [correlation({ launchToken: 'tok-1' })]
    )
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['reused-terminal'])
  })

  test('unverified: no authenticated hook correlation means no trust', () => {
    const result = reconcile([record()], [terminal()], [])
    expect(result.verified).toEqual([])
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['unverified'])
  })

  test('unverified: a correlation naming a different session does not confirm', () => {
    const result = reconcile(
      [record({ sessionID: 'ses-1' })],
      [terminal()],
      [correlation({ sessionID: 'ses-other' })]
    )
    expect(result.rejected.map((entry) => entry.reason)).toEqual(['unverified'])
  })

  test('ambiguous leaf: one session correlated to two live leaves rejects both', () => {
    const result = reconcile(
      [],
      [
        terminal({ leafId: LEAF_A, terminalHandle: 'term-1' }),
        terminal({ leafId: LEAF_B, terminalHandle: 'term-2' })
      ],
      [
        correlation({ leafId: LEAF_A, launchToken: 'tok-1' }),
        correlation({ leafId: LEAF_B, launchToken: 'tok-2' })
      ]
    )
    expect(result.verified).toEqual([])
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      'ambiguous-leaf',
      'ambiguous-leaf'
    ])
  })

  test('duplicate root: same session on the same leaf rejects both without a unique launch identity', () => {
    const result = reconcile(
      [
        record({ launchToken: 'tok-1', revision: 2 }),
        record({ launchToken: 'tok-2', revision: 5 })
      ],
      [terminal()],
      [correlation({ launchToken: 'tok-1' }), correlation({ launchToken: 'tok-2' })]
    )
    expect(result.verified).toEqual([])
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      'duplicate-root',
      'duplicate-root'
    ])
  })

  test('never invents a mapping for a correlation with no live terminal', () => {
    const result = reconcile([], [], [correlation()])
    expect(result.verified).toEqual([])
    expect(result.rejected).toEqual([])
  })

  test('released mappings are preserved untouched, never re-activated', () => {
    const result = reconcile([record({ lifecycle: 'released' })], [terminal()], [correlation()])
    expect(result.rejected).toEqual([])
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0].lifecycle).toBe('released')
  })

  test('one host correlation cannot create a mapping for an identical leaf on another host', () => {
    const result = reconcile(
      [],
      [
        terminal({ launchToken: 'tok-1' }),
        terminal({ executionHostId: 'ssh:box', terminalHandle: 'remote', launchToken: 'tok-1' })
      ],
      [correlation()],
      ['local', 'ssh:box']
    )
    expect(result.verified).toHaveLength(1)
    expect(result.verified[0].executionHostId).toBe('local')
  })
})
