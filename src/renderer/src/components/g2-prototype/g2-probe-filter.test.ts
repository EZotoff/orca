import { describe, expect, it } from 'vitest'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { applyProbeFilter, isProbeCard } from './g2-probe-filter'

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

function snapshot(cards: DashboardCard[]): DashboardSnapshot {
  return { generatedAt: 0, cards } as DashboardSnapshot
}

describe('g2 probe filter (contract clause f)', () => {
  it('drops PROBE-OK-class cards regardless of prefix', () => {
    expect(isProbeCard(card({ paneKey: 'a', conversationName: 'PROBE-OK' }))).toBe(true)
    expect(isProbeCard(card({ paneKey: 'b', conversationName: 'GLM-SJ-PROBE-OK probe' }))).toBe(true)
    expect(isProbeCard(card({ paneKey: 'c', conversationName: 'K3-PROBE-OK reply test' }))).toBe(true)
    expect(isProbeCard(card({ paneKey: 'd', conversationName: 'LB_OK' }))).toBe(true)
  })

  it('keeps real attention cards', () => {
    expect(isProbeCard(card({ paneKey: 'a', conversationName: 'Fix login regression' }))).toBe(false)
    expect(isProbeCard(card({ paneKey: 'b' }))).toBe(false)
  })

  it('a probe burst neither adds nor displaces a card', () => {
    const real = card({ paneKey: 'real', conversationName: 'Real escalation' })
    const before = applyProbeFilter(snapshot([real]))
    const burst = Array.from({ length: 12 }, (_, i) =>
      card({ paneKey: `probe-${i}`, conversationName: 'PROBE-OK' })
    )
    const after = applyProbeFilter(snapshot([real, ...burst]))
    expect(after.cards).toEqual(before.cards)
    expect(after.cards).toHaveLength(1)
  })
})
