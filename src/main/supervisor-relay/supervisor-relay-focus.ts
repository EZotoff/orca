// Focus action for the Supervisor relay (orca-transition plan Task 14, design
// §5 "Focus action"). Owns the trusted resolve-then-focus pipeline: a card is
// focused ONLY through a bridge-verified handle; anything the identity bridge
// cannot verify renders unhosted with a neutral reason — never a silent
// no-op, never a fabricated focus, never raw error text to the renderer.
import type { ExecutionHostId } from '../../shared/execution-host'
import type { SessionQuery } from '../identity-bridge/identity-bridge'
import type { OperatorView, OperatorViewCard } from './operator-view-reader'
import type { ResolveOutcome } from '../../shared/identity-bridge-types'
import type { SupervisorRelayFocusOutcome, SupervisorRelayUnhostedReason } from '../../shared/supervisor-relay-types'

/** Structural seam over IdentityBridge so tests inject fakes without a store. */
export type BridgeResolveSeam = {
  resolveOutcome(query: SessionQuery): Promise<ResolveOutcome>
}

/** The trusted focus RPC (`terminal.focus` with the exact handle, navigation 'host'). Injectable for tests. */
export type RuntimeFocusPort = {
  focusTerminal(terminalHandle: string, executionHostId: ExecutionHostId): Promise<boolean>
}

export type SupervisorRelayFocusOptions = {
  readonly bridge: BridgeResolveSeam
  readonly focus: RuntimeFocusPort
}

export class SupervisorRelayFocusService {
  private readonly bridge: BridgeResolveSeam
  private readonly focus: RuntimeFocusPort

  constructor(options: SupervisorRelayFocusOptions) {
    this.bridge = options.bridge
    this.focus = options.focus
  }

  /** Payload-time verification: undefined = hosted (jump allowed); a reason = render unhosted. */
  async verifyCard(card: OperatorViewCard): Promise<SupervisorRelayUnhostedReason | undefined> {
    const sessionRef = card.sessionRef
    if (sessionRef === undefined) {
      // No host-qualified identity from the read model: do not invent a mapping
      // for sessions created outside Orca (design §5 identity contract).
      return 'not-hosted'
    }
    const outcome = await this.bridge.resolveOutcome(sessionRef)
    return outcome.status === 'rejected' ? outcome.reason : undefined
  }

  /** The jump action. Card lookup and resolution stay in the trusted main process; only the scalar outcome crosses to the renderer. */
  async jump(cardId: string, view: OperatorView | undefined): Promise<SupervisorRelayFocusOutcome> {
    const card = view?.cards.find((candidate) => candidate.id === cardId)
    const sessionRef = card?.sessionRef
    if (card === undefined || sessionRef === undefined) {
      // No host-qualified identity: do not invent a mapping for sessions
      // created outside Orca (design §5 identity contract).
      return { status: 'unhosted', reason: 'not-hosted' }
    }
    const outcome = await this.bridge.resolveOutcome(sessionRef)
    if (outcome.status === 'rejected') {
      return { status: 'unhosted', reason: outcome.reason }
    }
    // One focus RPC with the exact bridge-verified handle — no extra async hops
    // (Task 8's ≥20-jump ≤1 s budget). Focus-API failure changes no state:
    // nothing was mutated, and a retry may succeed once the runtime answers.
    const focused = await this.focus.focusTerminal(
      outcome.leaf.terminalHandle,
      outcome.leaf.executionHostId
    )
    return focused ? { status: 'focused' } : { status: 'failed' }
  }
}
