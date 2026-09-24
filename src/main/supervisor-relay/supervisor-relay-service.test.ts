// Service-level battery for the Supervisor relay poller (orca-transition plan
// Task 12): payload-state mapping for every freeze class, the freeze-within-5s
// budget after the 30 s expiry, emit dedupe, and the contract's probe-noise
// burst case (a burst of rapid publications must not surface or displace a card).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SupervisorRelayService } from './supervisor-relay-service'
import type { SupervisorRelayPayload } from '../../shared/supervisor-relay-types'
import type { FsAdapter } from './operator-view-reader'

const T0 = 1_760_000_000_000

const card = (id: string): Record<string, unknown> => ({
  id,
  rootLabel: 'proj',
  sessionLabel: 'ses-a',
  reasonText: 'Deploy to prod?',
  premiseTexts: ['no-newer-turn: ses-a @ msg-a1'],
  ageSeconds: 0,
  severity: 'B',
  jumpAvailable: true
})

const snapshot = (overrides: Partial<Record<string, unknown>> = {}, nowMs: number = T0): string =>
  JSON.stringify({
    schemaVersion: 1,
    generation: 1,
    lastSeq: 5,
    producedAt: new Date(nowMs).toISOString(),
    cards: [card('att_1')],
    ...overrides
  })

const memFs = (get: () => string): FsAdapter => ({ readFile: async () => get() })

describe('supervisor relay service', () => {
  test('live snapshot → redacted live payload', async () => {
    const emitted: SupervisorRelayPayload[] = []
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() => snapshot()),
      wallMs: () => T0,
      monoMs: () => 0
    })
    await service.poll()
    expect(emitted.length).toBe(1)
    expect(emitted[0]?.state).toBe('live')
    expect(emitted[0]?.cards[0]?.id).toBe('att_1')
    expect(service.snapshot().state).toBe('live')
  })

  test('missing file with no prior image → not-running, never Idle cards', async () => {
    const emitted: SupervisorRelayPayload[] = []
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: {
        readFile: async () => {
          throw new Error('ENOENT')
        }
      },
      wallMs: () => T0,
      monoMs: () => 0
    })
    await service.poll()
    expect(emitted.length).toBe(0)
    // The snapshot (what a hydrating renderer pulls) must still say not-running.
    expect(service.snapshot().state).toBe('not-running')
    expect(service.snapshot().cards).toEqual([])
  })

  test('stale after a live image → frozen payload keeps greyed last-good cards + freezeReason', async () => {
    const emitted: SupervisorRelayPayload[] = []
    let raw = snapshot()
    let wall = T0
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() => raw),
      wallMs: () => wall,
      monoMs: () => wall - T0
    })
    await service.poll()
    expect(emitted.at(-1)?.state).toBe('live')

    wall = T0 + 31_000
    raw = snapshot({ producedAt: new Date(T0).toISOString() }, T0) // never refreshed
    await service.poll()
    const frozen = emitted.at(-1)
    expect(frozen?.state).toBe('frozen')
    expect(frozen?.freezeReason).toBe('stale')
    expect(frozen?.cards.map((c) => c.id)).toEqual(['att_1']) // greyed, not dropped, not Idle
  })

  test('invalid schema → neutral error payload with no cards and no action', async () => {
    const emitted: SupervisorRelayPayload[] = []
    let raw = snapshot()
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() => raw),
      wallMs: () => T0,
      monoMs: () => 0
    })
    await service.poll()
    expect(emitted.at(-1)?.state).toBe('live')

    raw = '{not json'
    await service.poll()
    const errored = emitted.at(-1)
    expect(errored?.state).toBe('error')
    expect(errored?.cards).toEqual([])
    expect(errored?.generation).toBe(1) // last-good diagnostics only
  })

  test('identical outcomes emit once (dedupe)', async () => {
    const emitted: SupervisorRelayPayload[] = []
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() => snapshot()),
      wallMs: () => T0,
      monoMs: () => 0
    })
    await service.poll()
    await service.poll()
    expect(emitted.length).toBe(1)
  })

  test('(probe-noise) a burst of rapid publications never surfaces or displaces a card', async () => {
    // The publisher excludes probe sessions from the read model (contract
    // publication clause f). At the view level that means a probe burst
    // arrives as a rapid run of heartbeat publications with the SAME card set:
    // the relay must stay live, keep the same cards, and never freeze.
    const emitted: SupervisorRelayPayload[] = []
    let generation = 1
    let wall = T0
    let raw = snapshot({ generation }, wall)
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() => raw),
      wallMs: () => wall,
      monoMs: () => wall - T0
    })
    await service.poll() // initial poll lands
    for (let burst = 0; burst < 10; burst += 1) {
      wall += 100
      generation += 1
      raw = snapshot({ generation }, wall)
      await service.poll()
    }
    // Generation advances each publication (legitimate), so payloads are
    // re-emitted — but every one stays live with the SAME single card: the
    // burst neither surfaces a new card nor displaces/greys the existing one.
    expect(emitted.length).toBe(11)
    for (const item of emitted) {
      expect(item.state).toBe('live')
      expect(item.cards.map((c) => c.id)).toEqual(['att_1'])
    }
  })

  describe('freeze lands within 5 s after the 30 s budget (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(T0)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    test('validity tick greys the cards after 31 s without a fresh publication', async () => {
      const emitted: SupervisorRelayPayload[] = []
      let raw = snapshot()
      let wall = T0
      const service = new SupervisorRelayService({
        path: 'operator-view.json',
        onPayload: (payload) => emitted.push(payload),
        fs: memFs(() => raw),
        wallMs: () => wall,
        monoMs: () => wall - T0,
        pollMs: 5_000,
        tickMs: 1_000
      })
      service.start()
      // Let the initial poll land (microtask), then advance past the budget.
      await vi.advanceTimersByTimeAsync(0)
      expect(emitted.at(-1)?.state).toBe('live')

      wall = T0 + 31_000
      vi.setSystemTime(wall)
      raw = snapshot({ producedAt: new Date(T0).toISOString() }, T0)
      await vi.advanceTimersByTimeAsync(5_000)
      const frozen = emitted.at(-1)
      expect(frozen?.state).toBe('frozen')
      expect(frozen?.freezeReason).toBe('stale')
      expect(frozen?.cards.length).toBe(1) // greyed, jumps disabled renderer-side
      service.stop()
    })
  })
})

describe('supervisor relay service card verification (Task 14)', () => {
  test('bridge verification drives jumpAvailable and the unhosted reason', async () => {
    const emitted: SupervisorRelayPayload[] = []
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: (payload) => emitted.push(payload),
      fs: memFs(() =>
        snapshot({
          cards: [card('att_1'), card('att_2')]
        })
      ),
      wallMs: () => T0,
      monoMs: () => 0,
      cardVerifier: async () => new Map([['att_2', 'not-hosted']])
    })
    await service.poll()
    expect(emitted[0]?.cards[0]).toMatchObject({ id: 'att_1', jumpAvailable: true })
    expect(emitted[0]?.cards[1]).toMatchObject({
      id: 'att_2',
      jumpAvailable: false,
      unhostedReason: 'not-hosted'
    })
  })

  test('currentView exposes the trusted view (with sessionRefs) for the focus action', async () => {
    const service = new SupervisorRelayService({
      path: 'operator-view.json',
      onPayload: () => undefined,
      fs: memFs(() =>
        snapshot({
          cards: [
            {
              ...card('att_1'),
              sessionRef: {
                executionHostId: 'local',
                canonicalRoot: '/repo',
                sessionID: 'ses-a'
              }
            }
          ]
        })
      ),
      wallMs: () => T0,
      monoMs: () => 0
    })
    await service.poll()
    expect(service.currentView()?.cards[0]?.sessionRef).toMatchObject({ sessionID: 'ses-a' })
  })
})
