// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'

const mocks = vi.hoisted(() => {
  const snapshot: DashboardSnapshot = { generatedAt: 1, cards: [], workspaces: [] }
  return {
    snapshot,
    revealDashboardAgent: vi.fn(),
    activateAndRevealWorkspace: vi.fn()
  }
})

vi.mock('../dashboard/useLiveDashboardSnapshot', () => ({
  useLiveDashboardSnapshot: () => mocks.snapshot
}))

vi.mock('../dashboard/reveal-dashboard-agent', () => ({
  revealDashboardAgent: mocks.revealDashboardAgent
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))

vi.mock('@/components/AgentStateDot', () => ({
  AgentStateDot: () => null
}))

vi.mock('../dashboard-popout/AgentKanbanBoard', () => ({
  bucketLabel: (bucket: string) => bucket
}))

vi.mock('../dashboard-popout/AgentKanbanCard', () => ({
  formatDashboardCardTime: () => 'just now'
}))

vi.mock('../supervisor-relay/SupervisorRelayView', () => ({
  SupervisorRelayView: () => <section data-supervisor-relay-stub="" />
}))

vi.mock('@/store/selectors', () => ({
  useWorktreeById: (worktreeId: string | null) =>
    worktreeId === 'w'
      ? { id: 'w', branch: 'refs/heads/main', head: 'abc1234', worktreeName: 'wt' }
      : null
}))

import { OverviewPanel } from './OverviewPanel'

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

function snapshotWith(cards: DashboardCard[]): DashboardSnapshot {
  return {
    generatedAt: 1,
    cards,
    workspaces: [
      {
        repoId: 'r-quiet',
        worktreeId: 'w-quiet',
        repoName: 'quiet',
        worktreeName: 'quiet-wt',
        hostKind: 'local',
        executionHostId: 'local',
        workspaceKind: 'worktree'
      }
    ]
  }
}

const initialState = useAppStore.getInitialState()

beforeEach(() => {
  useAppStore.setState({
    ...initialState,
    overviewPanelCollapsed: false,
    gitStatusByWorktree: { w: [{ path: 'src/a.ts', status: 'modified', area: 'unstaged' }] }
  }, true)
  mocks.snapshot = snapshotWith([
    card({
      paneKey: 'a1',
      repoName: 'alpha',
      conversationName: 'Fix login',
      tabId: 'tab-a1',
      leafId: 'leaf-a1',
      stateChangedAt: 30
    }),
    card({
      paneKey: 'a2',
      repoName: 'alpha',
      conversationName: 'Review PR',
      tabId: 'tab-a2',
      leafId: 'leaf-a2',
      stateChangedAt: 20
    }),
    card({
      paneKey: 'b1',
      bucket: 'working',
      dotState: 'working',
      repoName: 'beta',
      conversationName: 'Run migration'
    })
  ])
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('OverviewPanel', () => {
  it('renders the dense list and the persistent rail with per-project Needs You counts', () => {
    const { container, getByLabelText } = render(<OverviewPanel />)
    expect(container.querySelector('[data-overview-collapsed="false"]')).not.toBeNull()
    expect(container.querySelector('[data-overview-band="attention"]')).not.toBeNull()
    // Rail: alpha badge counts both attention cards; beta/quiet rows exist too.
    const badge = container.querySelector('[data-overview-attention-count="alpha"]')
    expect(badge?.textContent).toBe('2')
    expect(container.querySelector('[data-overview-rail-project="beta"]')).not.toBeNull()
    // Cardless (idle/unknown) project still gets a rail row.
    expect(container.querySelector('[data-overview-rail-project="quiet"]')).not.toBeNull()
    expect(getByLabelText('Projects overview rail')).not.toBeNull()
  })

  it('collapses to the rail and expands back via the toggle button', () => {
    const { container, getByLabelText } = render(<OverviewPanel />)
    fireEvent.click(getByLabelText('Collapse overview panel'))
    expect(useAppStore.getState().overviewPanelCollapsed).toBe(true)
    // List is gone; the rail with its Needs You badge stays.
    expect(container.querySelector('[data-overview-collapsed="true"]')).not.toBeNull()
    expect(container.querySelector('[data-overview-band]')).toBeNull()
    expect(container.querySelector('[data-overview-attention-count="alpha"]')).not.toBeNull()
    fireEvent.click(getByLabelText('Expand overview panel'))
    expect(useAppStore.getState().overviewPanelCollapsed).toBe(false)
    expect(container.querySelector('[data-overview-band="attention"]')).not.toBeNull()
  })

  it('jumps from a focused rail row to the project’s highest-priority session', () => {
    const { container } = render(<OverviewPanel />)
    const row = container.querySelector<HTMLButtonElement>('[data-overview-rail-project="alpha"]')
    expect(row).not.toBeNull()
    row!.focus()
    expect(document.activeElement).toBe(row)
    fireEvent.click(row!)
    expect(mocks.revealDashboardAgent).toHaveBeenCalledTimes(1)
    // The newest attention card (a1) is the jump target, not the older one (a2).
    expect(mocks.revealDashboardAgent).toHaveBeenCalledWith({
      repoId: 'r',
      worktreeId: 'w',
      tabId: 'tab-a1',
      leafId: 'leaf-a1'
    })
  })

  it('activates the workspace for a cardless (idle/unknown) rail row', () => {
    const { container } = render(<OverviewPanel />)
    const row = container.querySelector<HTMLButtonElement>('[data-overview-rail-project="quiet"]')
    fireEvent.click(row!)
    expect(mocks.revealDashboardAgent).not.toHaveBeenCalled()
    expect(mocks.activateAndRevealWorkspace).toHaveBeenCalledWith('w-quiet', {
      executionHostId: 'local'
    })
  })

  it('jumps from a dense-list row to that exact card’s pane', () => {
    const { container } = render(<OverviewPanel />)
    fireEvent.click(container.querySelector('[data-overview-card="b1"]')!)
    expect(mocks.revealDashboardAgent).toHaveBeenCalledTimes(1)
  })

  it('probe-class sessions never render as rows or rail entries', () => {
    mocks.snapshot = snapshotWith([
      card({ paneKey: 'real', repoName: 'alpha', conversationName: 'Real escalation' }),
      card({ paneKey: 'probe', repoName: 'probeville', conversationName: 'PROBE-OK' })
    ])
    const { container } = render(<OverviewPanel />)
    expect(container.querySelector('[data-overview-rail-project="probeville"]')).toBeNull()
    expect(container.querySelector('[data-overview-card="probe"]')).toBeNull()
    expect(container.querySelector('[data-overview-rail-project="alpha"]')).not.toBeNull()
  })

  it('embeds the Supervisor escalation section (widget 3) above the agent bands', () => {
    const { container } = render(<OverviewPanel />)
    expect(container.querySelector('[data-overview-supervisor] [data-supervisor-relay-stub]')).not.toBeNull()
  })

  it('shows the branch label and dirty dot on the rail (widget 4)', () => {
    const { container } = render(<OverviewPanel />)
    expect(container.querySelector('[data-overview-rail-git="alpha"]')?.textContent).toContain('main')
    expect(container.querySelector('[data-overview-rail-dirty="alpha"]')).not.toBeNull()
    // Cardless project without git identity renders no indicator.
    expect(container.querySelector('[data-overview-rail-git="quiet"]')).toBeNull()
  })

  it('renders the fixed bucket-count chips (Needs You / Working / Done / Idle)', () => {
    const { container } = render(<OverviewPanel />)
    const chips = [...container.querySelectorAll('[data-overview-count]')]
    expect(chips.map((chip) => chip.getAttribute('data-overview-count'))).toEqual([
      'attention',
      'working',
      'done',
      'idle'
    ])
    expect(chips.map((chip) => chip.textContent)).toEqual(['2', '1', '0', '0'])
  })

  it('shows a live subagent count on cards that spawned subagents', () => {
    mocks.snapshot = snapshotWith([
      card({
        paneKey: 'sub',
        repoName: 'alpha',
        conversationName: 'Fix login',
        subagents: [
          { id: '1', name: 'explore', dotState: 'working' },
          { id: '2', name: 'oracle', dotState: 'blocked' }
        ]
      })
    ])
    const { container } = render(<OverviewPanel />)
    expect(container.querySelector('[data-overview-subagents="sub"]')?.textContent).toBe('+2')
  })
})
