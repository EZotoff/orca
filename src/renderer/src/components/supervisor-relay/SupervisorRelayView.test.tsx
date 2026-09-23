// @vitest-environment happy-dom
// View-level battery for the Supervisor relay (orca-transition plan Task 12):
// escaped text-node rendering, stale/grey + disabled jump, neutral error card,
// v1 unavailable actions note, and the probe-noise invariant at the view level
// (a burst of identical live payloads never changes what is rendered).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SupervisorRelayCards } from './SupervisorRelayView'
import type { SupervisorRelayPayload } from '../../../../shared/supervisor-relay-types'

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
