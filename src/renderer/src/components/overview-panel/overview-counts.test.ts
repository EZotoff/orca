import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import {
  buildOverviewCountChips,
  cardLabelsOf,
  countBuckets,
  needsYouCount
} from './overview-counts'

function card(overrides: Partial<DashboardCard> & { paneKey: string }): DashboardCard {
  return {
    ptyId: null,
    agentType: 'opencode',
    bucket: 'working',
    dotState: 'working',
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
    unseen: false,
    ...overrides
  } satisfies DashboardCard
}

const snapshot: DashboardSnapshot = {
  generatedAt: 1,
  cards: [
    card({ paneKey: 'a', bucket: 'attention', repoName: 'alpha' }),
    card({ paneKey: 'a2', bucket: 'attention', repoName: 'beta' }),
    card({ paneKey: 'b', bucket: 'working', repoName: 'alpha' }),
    card({ paneKey: 'c', bucket: 'done', repoName: 'alpha', unseen: true }),
    card({ paneKey: 'd', bucket: 'idle', repoName: 'gamma' })
  ],
  workspaces: []
}

describe('countBuckets', () => {
  it('counts every bucket independently', () => {
    expect(countBuckets(snapshot.cards)).toEqual({ attention: 2, working: 1, done: 1, idle: 1 })
  })

  it('empty snapshot yields all-zero counts', () => {
    expect(countBuckets([])).toEqual({ attention: 0, working: 0, done: 0, idle: 0 })
  })
})

describe('needsYouCount', () => {
  it('totals Needs You across projects', () => {
    expect(needsYouCount(snapshot.cards)).toBe(2)
  })
})

describe('buildOverviewCountChips', () => {
  it('renders chips in bucket order with zero-count chips retained', () => {
    const empty: DashboardSnapshot = { generatedAt: 1, cards: [], workspaces: [] }
    expect(buildOverviewCountChips(empty)).toEqual([
      { bucket: 'attention', count: 0 },
      { bucket: 'working', count: 0 },
      { bucket: 'done', count: 0 },
      { bucket: 'idle', count: 0 }
    ])
    expect(buildOverviewCountChips(snapshot).map((chip) => chip.count)).toEqual([2, 1, 1, 1])
  })
})

describe('cardLabelsOf', () => {
  it('uses the conversation name and lists live subagent names', () => {
    const labels = cardLabelsOf(
      card({
        paneKey: 's',
        conversationName: 'Fix login',
        subagents: [
          { id: '1', name: 'explore', dotState: 'working' },
          { id: '2', name: 'oracle', dotState: 'blocked' }
        ]
      })
    )
    expect(labels).toEqual({
      project: 'repo',
      title: 'Fix login',
      subagentNames: ['explore', 'oracle']
    })
  })

  it('falls back to task text and empty subagent list', () => {
    expect(cardLabelsOf(card({ paneKey: 'x', task: 'Run migration' }))).toEqual({
      project: 'repo',
      title: 'Run migration',
      subagentNames: []
    })
  })
})
