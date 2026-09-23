// First-party Supervisor relay view (orca-transition plan Task 12) — the
// read-only ambient consumer of the Supervisor's operator-view.json read
// model. Self-contained by design: Task 10 mounts it into the main-window
// shell; nothing here may assume a particular mount point.
//
// Trust boundary: every string arrives pre-validated and pre-redacted from
// the trusted main process and is rendered as an escaped React text node —
// no raw HTML, no Markdown interpretation, no auto-links. The jump affordance
// is a trusted internal button keyed by validated card id, never a URL in
// text (wiring lands with Task 13/14).
import type {
  SupervisorRelayCard,
  SupervisorRelayPayload
} from '../../../../shared/supervisor-relay-types'
import { useSupervisorRelay } from './useSupervisorRelay'

const STALE_LABEL = 'Supervisor state stale'

/** v1 exposes no ack/snooze/reply/SKIP/HOLD/DND — link the binding contract section. */
const UNAVAILABLE_ACTIONS_NOTE =
  'Acknowledge, snooze, and reply are unavailable in v1 (portable-supervisor-contract.md, "Operator read model").'

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

function RelayCard({
  card,
  live
}: {
  card: SupervisorRelayCard
  live: boolean
}) {
  const jumpEnabled = live && card.jumpAvailable
  return (
    <li
      className={`supervisor-relay-card${live ? '' : ' supervisor-relay-card--stale'}`}
      data-card-id={card.id}
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
      <button
        type="button"
        className="supervisor-relay-card__jump"
        disabled={!jumpEnabled}
        data-card-id={card.id}
        title={
          jumpEnabled
            ? 'Focus the session behind this card'
            : 'Jump is disabled while Supervisor state is stale'
        }
        // Task 13/14 wire the focus bridge; v1 never navigates from card text.
        onClick={() => undefined}
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
export function SupervisorRelayCards({ payload }: { payload: SupervisorRelayPayload }) {
  const live = payload.state === 'live'
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
            <RelayCard key={card.id} card={card} live={live} />
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
  return <SupervisorRelayCards payload={payload} />
}
