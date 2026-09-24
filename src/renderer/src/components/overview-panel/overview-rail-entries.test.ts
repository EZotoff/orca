import { describe, expect, it } from 'vitest'
import type {
  DashboardCard,
  DashboardSnapshot,
  DashboardWorkspace
} from '../../../../shared/dashboard-snapshot'
import { applyProbeFilter } from './probe-card-filter'
import { buildOverviewRailEntries } from './overview-rail-entries'

function card(overrides: Partial<DashboardCard> & { paneKey: string }): DashboardCard {
  return {
    ptyId: null,
    agentType: 'opencode',
    bucket: 'attention',
    dotState: 'waiting',
    task: 'task',
    repoId: 'r',
    worktreeId: 'w',
    tabId: 't',
    leafId: 'l',
    repoName: 'repo',
    worktreeName: 'wt',
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: true,
    ...overrides
  } satisfies DashboardCard
}

function workspace(overrides: Partial<DashboardWorkspace>): DashboardWorkspace {
  return {
    repoId: 'r2',
    worktreeId: 'w2',
    repoName: 'repo2',
    worktreeName: 'wt2',
    hostKind: 'local',
    executionHostId: 'local',
    workspaceKind: 'worktree',
    ...overrides
  }
}

function snapshot(
  cards: DashboardCard[],
  workspaces: DashboardWorkspace[] = []
): DashboardSnapshot {
  return { generatedAt: 0, cards, workspaces }
}

describe('buildOverviewRailEntries', () => {
  it('groups cards into one entry per project with the per-project status set', () => {
    const entries = buildOverviewRailEntries(
      snapshot([
        card({ paneKey: 'a', bucket: 'attention', repoName: 'alpha' }),
        card({ paneKey: 'b', bucket: 'working', dotState: 'working', repoName: 'alpha' }),
        card({ paneKey: 'c', bucket: 'idle', dotState: 'idle', repoName: 'beta' })
      ])
    )
    const alpha = entries.find((e) => e.name === 'alpha')
    expect(alpha?.statuses).toEqual(['attention', 'working'])
    const beta = entries.find((e) => e.name === 'beta')
    expect(beta?.statuses).toEqual(['idle'])
  })

  it('counts Needs You per project', () => {
    const entries = buildOverviewRailEntries(
      snapshot([
        card({ paneKey: 'a', bucket: 'attention', repoName: 'alpha' }),
        card({ paneKey: 'b', bucket: 'attention', repoName: 'alpha' }),
        card({ paneKey: 'c', bucket: 'working', dotState: 'working', repoName: 'alpha' })
      ])
    )
    expect(entries.find((e) => e.name === 'alpha')?.attention).toBe(2)
  })

  it('orders Needs You projects first, then alphabetically', () => {
    const entries = buildOverviewRailEntries(
      snapshot([
        card({ paneKey: 'a', bucket: 'working', dotState: 'working', repoName: 'zeta' }),
        card({ paneKey: 'b', bucket: 'attention', repoName: 'mid' }),
        card({ paneKey: 'c', bucket: 'working', dotState: 'working', repoName: 'alpha' })
      ])
    )
    expect(entries.map((e) => e.name)).toEqual(['mid', 'alpha', 'zeta'])
  })

  it('includes cardless projects from workspaces with empty status and no jump card', () => {
    const entries = buildOverviewRailEntries(
      snapshot(
        [card({ paneKey: 'a', bucket: 'working', dotState: 'working', repoName: 'alpha' })],
        [workspace({ repoName: 'alpha' }), workspace({ repoName: 'quiet', worktreeName: 'qt' })]
      )
    )
    const quiet = entries.find((e) => e.name === 'quiet')
    expect(quiet).toBeDefined()
    expect(quiet?.statuses).toEqual([])
    expect(quiet?.attention).toBe(0)
    expect(quiet?.jumpCard).toBeNull()
    expect(quiet?.workspace?.worktreeId).toBe('w2')
  })

  it('falls back to the worktree name when repoName is empty', () => {
    const entries = buildOverviewRailEntries(
      snapshot([card({ paneKey: 'a', repoName: '', worktreeName: 'wt-label' })])
    )
    expect(entries.map((e) => e.name)).toEqual(['wt-label'])
  })

  it('resolves the jump target to the highest-priority, most-recent card', () => {
    const entries = buildOverviewRailEntries(
      snapshot([
        card({ paneKey: 'w', bucket: 'working', dotState: 'working', stateChangedAt: 50 }),
        card({ paneKey: 'a-old', bucket: 'attention', stateChangedAt: 10 }),
        card({ paneKey: 'a-new', bucket: 'attention', stateChangedAt: 40 })
      ])
    )
    // attention beats working; within attention the newest state change wins.
    expect(entries[0]?.jumpCard?.paneKey).toBe('a-new')
  })

  it('a probe burst leaves neither a rail entry nor a jump target', () => {
    const real = card({ paneKey: 'real', conversationName: 'Real escalation' })
    const burst = Array.from({ length: 12 }, (_, i) =>
      card({ paneKey: `probe-${i}`, conversationName: 'PROBE-OK', bucket: 'attention' })
    )
    const entries = buildOverviewRailEntries(applyProbeFilter(snapshot([real, ...burst])))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.jumpCard?.paneKey).toBe('real')
  })
})
