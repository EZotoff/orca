import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { buildOverviewBands } from './overview-bands'

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

function snapshot(cards: DashboardCard[], showIdle?: boolean): DashboardSnapshot {
  return { generatedAt: 0, cards, ...(showIdle !== undefined ? { showIdle } : {}) }
}

describe('buildOverviewBands', () => {
  it('groups cards into priority bands in bucket order', () => {
    const bands = buildOverviewBands(
      snapshot([
        card({ paneKey: 'w', bucket: 'working', dotState: 'working' }),
        card({ paneKey: 'a', bucket: 'attention' }),
        card({ paneKey: 'd', bucket: 'done', dotState: 'done' })
      ])
    )
    expect(bands.map((b) => b.bucket)).toEqual(['attention', 'working', 'done'])
    expect(bands[0]?.cards.map((c) => c.paneKey)).toEqual(['a'])
    expect(bands[1]?.cards.map((c) => c.paneKey)).toEqual(['w'])
  })

  it('sorts each band most-recently-moved first, matching the board', () => {
    const bands = buildOverviewBands(
      snapshot([
        card({ paneKey: 'old', bucket: 'attention', stateChangedAt: 10 }),
        card({ paneKey: 'new', bucket: 'attention', stateChangedAt: 90 })
      ])
    )
    expect(bands[0]?.cards.map((c) => c.paneKey)).toEqual(['new', 'old'])
  })

  it('gates the idle band on showIdle, matching the board', () => {
    const idleCard = card({ paneKey: 'i', bucket: 'idle', dotState: 'idle' })
    expect(
      buildOverviewBands(snapshot([idleCard])).map((b) => b.bucket)
    ).not.toContain('idle')
    expect(
      buildOverviewBands(snapshot([idleCard], true)).map((b) => b.bucket)
    ).toContain('idle')
  })
})
