// @vitest-environment happy-dom
// View-level battery for the Supervisor relay (orca-transition plan Task 12):
// escaped text-node rendering, stale/grey + disabled jump, neutral error card,
// v1 unavailable actions note, and the probe-noise invariant at the view level
// (a burst of identical live payloads never changes what is rendered).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SupervisorRelayCards } from './SupervisorRelayView'
import type { SupervisorRelayFocusOutcome, SupervisorRelayPayload } from '../../../../shared/supervisor-relay-types'

const payload = (overrides: Partial<SupervisorRelayPayload> = {}): SupervisorRelayPayload => ({
  schemaVersion: 1,
  generation: 3,
  lastSeq: 12,
  producedAt: new Date(0).toISOString(),
  state: 'live',
  cards: [
    {
      id: 'att_1',
      rootLabel: 'proj',
      sessionLabel: 'ses-a',
      reasonText: 'Deploy to prod?',
      premiseTexts: ['no-newer-turn: ses-a @ msg-a1'],
      age: 42,
      severity: 'B',
      jumpAvailable: true
    }
  ],
  ...overrides
})

const unhostedPayload = (
  reason: 'not-hosted' | 'stale-handle' | 'ambiguous-session'
): SupervisorRelayPayload =>
  payload({
    cards: [
      {
        id: 'att_1',
        rootLabel: 'proj',
        sessionLabel: 'ses-a',
        reasonText: 'Deploy to prod?',
        premiseTexts: [],
        age: 42,
        severity: 'B',
        jumpAvailable: false,
        unhostedReason: reason
      }
    ]
  })

afterEach(cleanup)

describe('SupervisorRelayCards', () => {
  test('renders card text as escaped text nodes — no HTML, Markdown, or links', () => {
    const hostile = payload({
      cards: [
        {
          id: 'att_evil',
          rootLabel: 'proj',
          sessionLabel: '<img src=x onerror=alert(1)>',
          reasonText: '<script>alert(1)</script> [click](https://evil.example)',
          premiseTexts: ['<b>bold</b>'],
          age: 5,
          severity: 'A',
          jumpAvailable: true
        }
      ]
    })
    const { container } = render(<SupervisorRelayCards payload={hostile} />)
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.innerHTML).not.toContain('<img')
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getAllByText(/alert\(1\)/).length).toBeGreaterThan(0)
  })

  test('live card shows an enabled Jump keyed by the validated card id', () => {
    render(<SupervisorRelayCards payload={payload()} />)
    const jump = screen.getByRole('button', { name: 'Jump' })
    expect((jump as HTMLButtonElement).disabled).toBe(false)
    expect(jump.getAttribute('data-card-id')).toBe('att_1')
  })

  test('frozen payload greys cards, disables jumps, and labels "Supervisor state stale"', () => {
    render(<SupervisorRelayCards payload={payload({ state: 'frozen', freezeReason: 'stale' })} />)
    expect(screen.getByText('Supervisor state stale')).toBeDefined()
    const jump = screen.getByRole('button', { name: 'Jump' }) as HTMLButtonElement
    expect(jump.disabled).toBe(true)
    // Frozen cards stay visible (greyed), never converted to Idle.
    expect(screen.getByText('Deploy to prod?')).toBeDefined()
  })

  test('error payload renders a neutral error card with no action', () => {
    const { container } = render(<SupervisorRelayCards payload={payload({ state: 'error', cards: [] })} />)
    expect(screen.getByText('Supervisor state unavailable')).toBeDefined()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  test('not-running shows its own label, not "no escalations"', () => {
    render(<SupervisorRelayCards payload={payload({ state: 'not-running', cards: [] })} />)
    expect(screen.getByText('Supervisor not running')).toBeDefined()
    expect(screen.queryByText('No escalations needing you')).toBeNull()
  })

  test('v1 shows the unavailable-actions note linking the contract section', () => {
    render(<SupervisorRelayCards payload={payload()} />)
    expect(screen.getByText(/portable-supervisor-contract\.md/)).toBeDefined()
  })

  test('(probe-noise) a burst of identical live payloads renders the same single card', () => {
    for (let burst = 0; burst < 10; burst += 1) {
      cleanup()
      render(<SupervisorRelayCards payload={payload({ generation: 4 + burst })} />)
    }
    const cards = screen.getAllByText('Deploy to prod?')
    expect(cards).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Jump' }).getAttribute('data-card-id')).toBe('att_1')
  })
})

describe('SupervisorRelayCards focus action (Task 14)', () => {
  test('unhosted card renders its neutral label with the jump disabled', () => {
    const { container } = render(<SupervisorRelayCards payload={unhostedPayload('not-hosted')} />)
    expect(screen.getByText('Not open in Orca')).toBeDefined()
    const jump = screen.getByRole('button', { name: 'Jump' }) as HTMLButtonElement
    expect(jump.disabled).toBe(true)
    expect(container.querySelector('.supervisor-relay-card--unhosted')).not.toBeNull()
    expect(container.querySelector('[data-card-id="att_1"]')?.getAttribute('data-unhosted')).toBe(
      'not-hosted'
    )
  })

  test('each unhosted rejection class maps to a fixed neutral label, never raw error text', () => {
    const cases: readonly [string, string][] = [
      ['stale-handle', 'Session pane no longer exists'],
      ['ambiguous-session', 'Session location ambiguous']
    ]
    for (const [reason, label] of cases) {
      cleanup()
      render(<SupervisorRelayCards payload={unhostedPayload(reason as 'stale-handle')} />)
      expect(screen.getByText(label)).toBeDefined()
      expect(
        (screen.getByRole('button', { name: 'Jump' }) as HTMLButtonElement).disabled
      ).toBe(true)
    }
  })

  test('successful jump focuses: the card shows the focused affordance', async () => {
    const focusCard = vi.fn().mockResolvedValue({ status: 'focused' } satisfies SupervisorRelayFocusOutcome)
    const { container } = render(<SupervisorRelayCards payload={payload()} focusCard={focusCard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }))
    expect(focusCard).toHaveBeenCalledWith('att_1')
    await waitFor(() => {
      expect(container.querySelector('.supervisor-relay-card--focused')).not.toBeNull()
    })
  })

  test('jump returning unhosted re-renders the card unhosted with the neutral label', async () => {
    const focusCard = vi.fn().mockResolvedValue({
      status: 'unhosted',
      reason: 'reused-terminal'
    } satisfies SupervisorRelayFocusOutcome)
    const { container } = render(<SupervisorRelayCards payload={payload()} focusCard={focusCard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }))
    await waitFor(() => {
      expect(screen.getByText('Terminal was reused')).toBeDefined()
    })
    expect(
      (screen.getByRole('button', { name: 'Jump' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(container.querySelector('.supervisor-relay-card--unhosted')).not.toBeNull()
  })

  test('focus-API failure shows a neutral note and the card stays actionable', async () => {
    const focusCard = vi.fn().mockResolvedValue({ status: 'failed' } satisfies SupervisorRelayFocusOutcome)
    render(<SupervisorRelayCards payload={payload()} focusCard={focusCard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }))
    await waitFor(() => {
      expect(screen.getByText('Could not focus this session')).toBeDefined()
    })
    expect(screen.getByText('Deploy to prod?')).toBeDefined()
    expect((screen.getByRole('button', { name: 'Jump' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
