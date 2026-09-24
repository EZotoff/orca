// First-party Supervisor relay view (orca-transition plan Task 12) — the
// read-only ambient consumer of the Supervisor's operator-view.json read
// model, plus the Task 14 focus action: the jump button runs the trusted
// resolve-then-focus pipeline in main and renders only scalar outcomes.
//
// Trust boundary: every string arrives pre-validated and pre-redacted from
// the trusted main process and is rendered as an escaped React text node —
// no raw HTML, no Markdown interpretation, no auto-links. The jump affordance
// is a trusted internal button keyed by validated card id, never a URL in
// text. Unhosted cards (bridge cannot verify) render a fixed neutral label
// with the jump disabled — never a silent no-op, never a fabricated focus.
import { useEffect, useRef, useState } from 'react'
import type {
  SupervisorRelayCard,
  SupervisorRelayFocusOutcome,
  SupervisorRelayPayload,
  SupervisorRelayUnhostedReason
} from '../../../../shared/supervisor-relay-types'
import { useSupervisorRelay } from './useSupervisorRelay'

const STALE_LABEL = 'Supervisor state stale'

/** v1 exposes no ack/snooze/reply/SKIP/HOLD/DND — link the binding contract section. */
const UNAVAILABLE_ACTIONS_NOTE =
  'Acknowledge, snooze, and reply are unavailable in v1 (portable-supervisor-contract.md, "Operator read model").'

/** Fixed neutral labels keyed by the scalar unhosted reason — no raw error text ever reaches this map. */
const UNHOSTED_LABELS: Record<SupervisorRelayUnhostedReason, string> = {
  'not-hosted': 'Not open in Orca',
  unverified: 'Session not verified',
  'stale-handle': 'Session pane no longer exists',
  'host-mismatch': 'Session host changed',
  'reused-terminal': 'Terminal was reused',
  'duplicate-root': 'Duplicate project roots',
  'ambiguous-leaf': 'Session location ambiguous',
  'ambiguous-session': 'Session location ambiguous'
}

/** Neutral inline note when the focus API itself fails; the card stays and retry remains possible. */
const FOCUS_FAILED_NOTE = 'Could not focus this session'

const FOCUSED_PULSE_MS = 1500

function severityLabel(severity: SupervisorRelayCard['severity']): string {
  return `Severity ${severity}`
}

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) {
    return `${ageSeconds}s`
  }
  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)}m`
  }
  return `${Math.floor(ageSeconds / 3600)}h`
}

type JumpOutcome = SupervisorRelayFocusOutcome | undefined

function RelayCard({
  card,
  live,
  outcome,
  jumped,
  onJump
}: {
  card: SupervisorRelayCard
  live: boolean
  outcome: JumpOutcome
  jumped: boolean
  onJump: (card: SupervisorRelayCard) => void
}) {
  const unhostedReason =
    card.unhostedReason ?? (outcome?.status === 'unhosted' ? outcome.reason : undefined)
  const jumpEnabled = live && card.jumpAvailable && unhostedReason === undefined
  return (
    <li
      className={`supervisor-relay-card${live ? '' : ' supervisor-relay-card--stale'}${
        unhostedReason !== undefined ? ' supervisor-relay-card--unhosted' : ''
      }${jumped ? ' supervisor-relay-card--focused' : ''}`}
      data-card-id={card.id}
      data-unhosted={unhostedReason ?? undefined}
    >
      <div className="supervisor-relay-card__head">
        <span className="supervisor-relay-card__severity">{severityLabel(card.severity)}</span>
        <span className="supervisor-relay-card__labels">
          {card.rootLabel} · {card.sessionLabel}
        </span>
        <span className="supervisor-relay-card__age">{formatAge(card.age)}</span>
      </div>
      <p className="supervisor-relay-card__reason">{card.reasonText}</p>
      {card.premiseTexts.length > 0 && (
        <ul className="supervisor-relay-card__premises">
          {card.premiseTexts.map((premise, index) => (
            <li key={index}>{premise}</li>
          ))}
        </ul>
      )}
      {unhostedReason !== undefined && (
        <p className="supervisor-relay-card__unhosted-label">{UNHOSTED_LABELS[unhostedReason]}</p>
      )}
      {outcome?.status === 'failed' && (
        <p className="supervisor-relay-card__focus-note">{FOCUS_FAILED_NOTE}</p>
      )}
      <button
        type="button"
        className="supervisor-relay-card__jump"
        disabled={!jumpEnabled}
        data-card-id={card.id}
        title={
          unhostedReason !== undefined
            ? UNHOSTED_LABELS[unhostedReason]
            : jumpEnabled
              ? 'Focus the session behind this card'
              : 'Jump is disabled while Supervisor state is stale'
        }
        onClick={() => onJump(card)}
      >
        Jump
      </button>
    </li>
  )
}

/**
 * Presentational core: renders an already-redacted payload. Exported for
 * tests and for Task 10 mounting; ambient usage goes through
 * <SupervisorRelayView /> which owns the subscription.
 */
export function SupervisorRelayCards({
  payload,
  focusCard
}: {
  payload: SupervisorRelayPayload
  focusCard?: (cardId: string) => Promise<SupervisorRelayFocusOutcome>
}) {
  const live = payload.state === 'live'
  const [outcomes, setOutcomes] = useState<Record<string, JumpOutcome>>({})
  const [jumpedCardId, setJumpedCardId] = useState<string | undefined>(undefined)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (pulseTimer.current !== undefined) {
        clearTimeout(pulseTimer.current)
      }
    }
  }, [])

  const handleJump = (card: SupervisorRelayCard): void => {
    if (focusCard === undefined) {
      return
    }
    void focusCard(card.id).then((outcome) => {
      setOutcomes((prev) => ({ ...prev, [card.id]: outcome }))
      if (outcome.status === 'focused') {
        setJumpedCardId(card.id)
        if (pulseTimer.current !== undefined) {
          clearTimeout(pulseTimer.current)
        }
        pulseTimer.current = setTimeout(() => {
          setJumpedCardId(undefined)
          pulseTimer.current = undefined
        }, FOCUSED_PULSE_MS)
      }
    })
  }

  if (payload.state === 'error') {
    // Neutral error card: no card data, no action (design §5 failure semantics).
    return (
      <section className="supervisor-relay" data-state="error">
        <header className="supervisor-relay__header">
          <h3>Supervisor</h3>
        </header>
        <p className="supervisor-relay__error">Supervisor state unavailable</p>
        <p className="supervisor-relay__note">{UNAVAILABLE_ACTIONS_NOTE}</p>
      </section>
    )
  }
  return (
    <section
      className={`supervisor-relay${live ? '' : ' supervisor-relay--stale'}`}
      data-state={payload.state}
    >
      <header className="supervisor-relay__header">
        <h3>Supervisor</h3>
        {!live && <span className="supervisor-relay__stale-label">{STALE_LABEL}</span>}
      </header>
      {payload.cards.length === 0 ? (
        <p className="supervisor-relay__empty">
          {payload.state === 'not-running'
            ? 'Supervisor not running'
            : 'No escalations needing you'}
        </p>
      ) : (
        <ul className="supervisor-relay__cards">
          {payload.cards.map((card) => (
            <RelayCard
              key={card.id}
              card={card}
              live={live}
              outcome={outcomes[card.id]}
              jumped={jumpedCardId === card.id}
              onJump={handleJump}
            />
          ))}
        </ul>
      )}
      <p className="supervisor-relay__note" title={UNAVAILABLE_ACTIONS_NOTE}>
        {UNAVAILABLE_ACTIONS_NOTE}
      </p>
    </section>
  )
}

/** Ambient relay view: subscribes to the main-process poller and renders the redacted payload. */
export function SupervisorRelayView(): React.JSX.Element {
  const payload = useSupervisorRelay()
  if (payload === undefined) {
    return (
      <section className="supervisor-relay" data-state="loading">
        <header className="supervisor-relay__header">
          <h3>Supervisor</h3>
        </header>
        <p className="supervisor-relay__empty">Loading Supervisor state…</p>
      </section>
    )
  }
  return <SupervisorRelayCards payload={payload} focusCard={window.api.supervisorRelay.focus} />
}
