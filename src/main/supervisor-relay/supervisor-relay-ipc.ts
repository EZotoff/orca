// Electron wiring for the Supervisor relay (orca-transition plan Task 12) and
// its focus action (Task 14). Owns the one privileged boundary: the poller
// lives here in main, only the redacted SupervisorRelayPayload ever crosses to
// renderers, and the jump runs resolve-then-focus entirely in main — the
// renderer sends a card id and receives a scalar outcome, never a handle.
import { BrowserWindow, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionHostId } from '../../shared/execution-host'
import {
  SUPERVISOR_RELAY_FOCUS_CHANNEL,
  SUPERVISOR_RELAY_SNAPSHOT_CHANNEL,
  SUPERVISOR_RELAY_UPDATE_CHANNEL,
  type SupervisorRelayFocusOutcome,
  type SupervisorRelayPayload,
  type SupervisorRelayUnhostedReason
} from '../../shared/supervisor-relay-types'
import { SupervisorRelayService } from './supervisor-relay-service'
import { SupervisorRelayFocusService, type RuntimeFocusPort } from './supervisor-relay-focus'
import { IdentityBridge } from '../identity-bridge/identity-bridge'
import { IdentityBridgeStore } from '../identity-bridge/identity-bridge-store'
import { defaultIdentityBridgePath } from '../identity-bridge/identity-bridge-paths'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'
import { getAppEnvironment } from '../../shared/app-environment'

/** Supervisor state directory per the portable-supervisor contract; ORCA_SUPERVISOR_VIEW_PATH overrides for fixture-driven tests. */
export function defaultOperatorViewPath(): string {
  const override = process.env['ORCA_SUPERVISOR_VIEW_PATH']
  if (override !== undefined && override !== '') {
    return override
  }
  return join(homedir(), '.local', 'state', 'opencode-supervisor', 'operator-view.json')
}

let service: SupervisorRelayService | undefined

function broadcast(payload: SupervisorRelayPayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(SUPERVISOR_RELAY_UPDATE_CHANNEL, payload)
    }
  }
}

/**
 * Runtime environment selector for a bridge-verified host. Only runtime-owned
 * hosts (`runtime:<environmentId>`) have a callable environment today; local
 * and SSH hosts gain routes when Task 16/18 wire the live inventory, so their
 * jumps fail closed instead of fabricating a target.
 */
function runtimeEnvironmentSelector(executionHostId: ExecutionHostId): string | undefined {
  if (executionHostId.startsWith('runtime:')) {
    return decodeURIComponent(executionHostId.slice('runtime:'.length))
  }
  return undefined
}

function runtimeFocusPort(userDataPath: string): RuntimeFocusPort {
  return {
    // terminal.focus with the exact bridge-verified handle; navigation 'host'
    // raises the Orca host surface (design §5 Focus action).
    focusTerminal: async (terminalHandle, executionHostId) => {
      const selector = runtimeEnvironmentSelector(executionHostId)
      if (selector === undefined) {
        return false
      }
      const response = await callRuntimeEnvironment(userDataPath, selector, 'terminal.focus', {
        terminal: terminalHandle,
        navigation: 'host'
      })
      return response.ok
    }
  }
}

/**
 * Register the relay IPC (snapshot pull, focus invoke) and start the
 * main-process poller. Read-only ambient chrome apart from the trusted focus
 * RPC: no writes, no sockets, no ports.
 */
export function registerSupervisorRelayIpc(path: string = defaultOperatorViewPath()): void {
  if (service !== undefined) {
    return
  }
  const userDataPath = getAppEnvironment().getPath('userData')
  // Task 16 supplies the live inventory + authenticated hook correlations.
  // Until then the bridge reconciles against empty sources: nothing verifies,
  // every card renders honestly unhosted, and no focus is ever fabricated.
  const bridge = new IdentityBridge({
    store: new IdentityBridgeStore(defaultIdentityBridgePath()),
    inventory: { listInventory: async () => ({ terminals: [], connectedHosts: [] }) },
    correlations: { listCorrelations: async () => [] }
  })
  const focus = new SupervisorRelayFocusService({
    bridge,
    focus: runtimeFocusPort(userDataPath)
  })
  const started = new SupervisorRelayService({
    path,
    onPayload: broadcast,
    cardVerifier: async (view) => {
      // Sequential per card is fine at v1 density (≤20 cards); a batched
      // bridge pass lands with Task 16's real inventory sources.
      const unhosted = new Map<string, SupervisorRelayUnhostedReason>()
      for (const card of view.cards) {
        const reason = await focus.verifyCard(card)
        if (reason !== undefined) {
          unhosted.set(card.id, reason)
        }
      }
      return unhosted
    }
  })
  service = started
  ipcMain.handle(SUPERVISOR_RELAY_SNAPSHOT_CHANNEL, () => started.snapshot())
  ipcMain.handle(SUPERVISOR_RELAY_FOCUS_CHANNEL, (_event, cardId: unknown) => {
    // Card id is a validated main-side key; never a URL/path from card text.
    return typeof cardId === 'string'
      ? focus.jump(cardId, started.currentView())
      : Promise.resolve({ status: 'unhosted', reason: 'not-hosted' } satisfies SupervisorRelayFocusOutcome)
  })
  started.start()
}
