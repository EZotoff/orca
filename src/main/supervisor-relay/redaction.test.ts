// Redaction battery for the renderer boundary (orca-transition plan Task 12,
// design 40-oracle-design.md §5): malicious card payloads must come out
// scrubbed or — when the view is not a valid v1 image — as nothing at all
// (the service maps undefined to the neutral error card).
import { describe, expect, test } from 'vitest'
import {
  MAX_PREMISE_TEXTS,
  MAX_RELAY_CARDS,
  MAX_TEXT_CHARS,
  redactOperatorView
} from './redaction'
import type { OperatorView } from './operator-view-reader'

const viewCard = (overrides: Partial<OperatorView['cards'][number]> = {}): OperatorView['cards'][number] => ({
  id: 'att_1',
  rootLabel: 'proj',
  sessionLabel: 'ses-a',
  reasonText: 'Deploy to prod?',
  premiseTexts: ['no-newer-turn: ses-a @ msg-a1'],
  ageSeconds: 42,
  severity: 'B',
  jumpAvailable: true,
  ...overrides
})

const view = (cards: readonly OperatorView['cards'][number][]): OperatorView => ({
  schemaVersion: 1,
  generation: 3,
  lastSeq: 12,
  producedAt: new Date(0).toISOString(),
  cards
})

describe('supervisor relay redaction', () => {
  test('scrubs credential/token/secret patterns from every text field', () => {
    const payload = redactOperatorView(
      view([
        viewCard({
          rootLabel: 'sk-abcdefgh12345678',
          sessionLabel: 'ghp_' + 'a'.repeat(30),
          reasonText: 'Use xoxb-1234567890abcdef keys',
          premiseTexts: ['bearer AbCdEfGhIjK1234567890', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature']
        })
      ]),
      'live'
    )
    expect(payload).toBeDefined()
    if (payload === undefined) return
    const card = payload.cards[0]
    expect(card).toBeDefined()
    if (card === undefined) return
    expect(card.rootLabel).not.toContain('sk-abcdefgh12345678')
    expect(card.sessionLabel).not.toContain('ghp_')
    expect(card.reasonText).not.toContain('xoxb-')
    const premises = card.premiseTexts.join(' ')
    expect(premises).not.toMatch(/\bbearer\s+[A-Za-z0-9._~+/=-]{10,}/)
    expect(premises).not.toContain('eyJhbGciOiJIUzI1NiJ9')
  })

  test('scrubs sensitive absolute paths (home dirs and ~)', () => {
    const payload = redactOperatorView(
      view([
        viewCard({
          rootLabel: '/home/ezotoff/secret-project',
          reasonText: 'edit ~/notes/credentials.txt then /Users/bob/token',
          premiseTexts: []
        })
      ]),
      'live'
    )
    expect(payload).toBeDefined()
    if (payload === undefined) return
    const card = payload.cards[0]
    expect(card).toBeDefined()
    if (card === undefined) return
    expect(card.rootLabel).not.toContain('/home/')
    expect(card.reasonText).not.toContain('/Users/bob/token')
    expect(card.reasonText).not.toContain('~/notes')
  })

  test('caps text fields, premise count, and card count', () => {
    const long = 'x'.repeat(MAX_TEXT_CHARS + 500)
    const payload = redactOperatorView(
      view([
        viewCard({
          reasonText: long,
          premiseTexts: Array.from({ length: MAX_PREMISE_TEXTS + 5 }, () => long)
        }),
        ...Array.from({ length: MAX_RELAY_CARDS + 5 }, (_, index) => viewCard({ id: `att_${index}` }))
      ]),
      'live'
    )
    expect(payload).toBeDefined()
    if (payload === undefined) return
    expect(payload.cards.length).toBe(MAX_RELAY_CARDS)
    for (const card of payload.cards) {
      expect(card.reasonText.length).toBeLessThanOrEqual(MAX_TEXT_CHARS)
      expect(card.premiseTexts.length).toBeLessThanOrEqual(MAX_PREMISE_TEXTS)
      for (const premise of card.premiseTexts) {
        expect(premise.length).toBeLessThanOrEqual(MAX_TEXT_CHARS)
      }
    }
  })

  test('forwards only whitelisted scalar fields — no extra properties', () => {
    const payload = redactOperatorView(view([viewCard()]), 'live')
    expect(payload).toBeDefined()
    if (payload === undefined) return
    expect(Object.keys(payload).sort()).toEqual([
      'cards',
      'generation',
      'lastSeq',
      'producedAt',
      'schemaVersion',
      'state'
    ])
    const card = payload.cards[0]
    expect(card).toBeDefined()
    if (card !== undefined) {
      expect(Object.keys(card).sort()).toEqual([
        'age',
        'id',
        'jumpAvailable',
        'premiseTexts',
        'reasonText',
        'rootLabel',
        'sessionLabel',
        'severity'
      ])
    }
  })

  test('non-v1 view → undefined (service renders the neutral error card)', () => {
    const mismatched = { ...view([]), schemaVersion: 2 } as unknown as OperatorView
    expect(redactOperatorView(mismatched, 'live')).toBeUndefined()
  })

  test('frozen payload carries the freeze reason and greyed cards', () => {
    const payload = redactOperatorView(view([viewCard()]), 'frozen', 'stale')
    expect(payload).toBeDefined()
    if (payload === undefined) return
    expect(payload.state).toBe('frozen')
    expect(payload.freezeReason).toBe('stale')
    expect(payload.cards.length).toBe(1)
  })

  test('age is forwarded as a non-negative rounded integer', () => {
    const payload = redactOperatorView(view([viewCard({ ageSeconds: 41.7 })]), 'live')
    expect(payload?.cards[0]?.age).toBe(42)
    expect(Number.isInteger(payload?.cards[0]?.age ?? 0)).toBe(true)
  })
})
