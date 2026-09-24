// Focus-action battery for the Supervisor relay (orca-transition plan Task
// 14): resolve-then-focus success, every rejection class → unhosted with the
// neutral scalar reason, focus-API failure with no state corruption. Fake
// bridge + fake focus port; no Electron, no fs.
import { describe, expect, test } from 'vitest'
import type { ResolveOutcome } from '../../shared/identity-bridge-types'
import type { OperatorView, OperatorViewCard } from './operator-view-reader'
import {
  SupervisorRelayFocusService,
  type BridgeResolveSeam,
  type RuntimeFocusPort
} from './supervisor-relay-focus'

const card = (overrides: Partial<OperatorViewCard> = {}): OperatorViewCard => ({
  id: 'att_1',
  rootLabel: 'proj',
  sessionLabel: 'ses-a',
  reasonText: 'Deploy to prod?',
  premiseTexts: [],
  ageSeconds: 42,
  severity: 'B',
  jumpAvailable: true,
  sessionRef: { executionHostId: 'local', canonicalRoot: '/repo', sessionID: 'ses-a' },
  ...overrides
})

const view = (cards: readonly OperatorViewCard[]): OperatorView => ({
  schemaVersion: 1,
  generation: 3,
  lastSeq: 12,
  producedAt: new Date(0).toISOString(),
  cards
})

class FakeBridge implements BridgeResolveSeam {
  outcome: ResolveOutcome = {
    status: 'verified',
    leaf: {
      executionHostId: 'local',
      canonicalRoot: '/repo',
      sessionID: 'ses-a',
      launchToken: 'tok-1',
      worktreeIdentity: 'wt2:local:inst-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      terminalHandle: 'term-1',
      revision: 2
    }
  }
  queries: unknown[] = []
  async resolveOutcome(query: unknown): Promise<ResolveOutcome> {
    this.queries.push(query)
    return this.outcome
  }
}

class FakeFocus implements RuntimeFocusPort {
  result = true
  calls: { handle: string; host: string }[] = []
  async focusTerminal(terminalHandle: string, executionHostId: string): Promise<boolean> {
    this.calls.push({ handle: terminalHandle, host: executionHostId })
    return this.result
  }
}

const makeService = () => {
  const bridge = new FakeBridge()
  const focus = new FakeFocus()
  return { bridge, focus, service: new SupervisorRelayFocusService({ bridge, focus }) }
}

describe('SupervisorRelayFocusService', () => {
  test('resolve-then-focus success focuses the exact bridge-verified handle', async () => {
    const { service, focus } = makeService()
    const outcome = await service.jump('att_1', view([card()]))
    expect(outcome).toEqual({ status: 'focused' })
    expect(focus.calls).toEqual([{ handle: 'term-1', host: 'local' }])
  })

  test('unknown card id is unhosted, never a focus', async () => {
    const { service, focus } = makeService()
    expect(await service.jump('att_missing', view([card()]))).toEqual({
      status: 'unhosted',
      reason: 'not-hosted'
    })
    expect(focus.calls).toHaveLength(0)
  })

  test('card without a sessionRef (session created outside Orca) is unhosted', async () => {
    const { service, bridge, focus } = makeService()
    const noRef = { ...card(), sessionRef: undefined }
    expect(await service.jump('att_1', view([noRef]))).toEqual({
      status: 'unhosted',
      reason: 'not-hosted'
    })
    expect(await service.verifyCard(noRef)).toBe('not-hosted')
    expect(bridge.queries).toHaveLength(0)
    expect(focus.calls).toHaveLength(0)
  })

  test.each([
    'stale-handle',
    'host-mismatch',
    'reused-terminal',
    'unverified',
    'duplicate-root',
    'ambiguous-leaf',
    'ambiguous-session',
    'not-hosted'
  ] as const)('rejection class %s renders unhosted and never focuses', async (reason) => {
    const { service, bridge, focus } = makeService()
    bridge.outcome = { status: 'rejected', reason }
    expect(await service.jump('att_1', view([card()]))).toEqual({
      status: 'unhosted',
      reason
    })
    expect(await service.verifyCard(card())).toBe(reason)
    expect(focus.calls).toHaveLength(0)
  })

  test('focus-API failure returns failed with no state corruption — a retry can succeed', async () => {
    const { service, focus } = makeService()
    focus.result = false
    expect(await service.jump('att_1', view([card()]))).toEqual({ status: 'failed' })
    focus.result = true
    expect(await service.jump('att_1', view([card()]))).toEqual({ status: 'focused' })
  })

  test('verifyCard returns undefined for a hosted card (jump stays available)', async () => {
    const { service } = makeService()
    expect(await service.verifyCard(card())).toBeUndefined()
  })
})
