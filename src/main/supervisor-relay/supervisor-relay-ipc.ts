// Electron wiring for the Supervisor relay (orca-transition plan Task 12).
// Owns the one privileged boundary: the poller lives here in main, and only
// the redacted SupervisorRelayPayload ever crosses to renderers.
import { BrowserWindow, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  SUPERVISOR_RELAY_SNAPSHOT_CHANNEL,
  SUPERVISOR_RELAY_UPDATE_CHANNEL,
  type SupervisorRelayPayload
} from '../../shared/supervisor-relay-types'
import { SupervisorRelayService } from './supervisor-relay-service'

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
 * Register the relay IPC (snapshot pull for renderer hydration) and start the
 * main-process poller. Read-only ambient chrome: no writes, no sockets, no ports.
 */
export function registerSupervisorRelayIpc(path: string = defaultOperatorViewPath()): void {
  if (service !== undefined) {
    return
  }
  const started = new SupervisorRelayService({ path, onPayload: broadcast })
  service = started
  ipcMain.handle(SUPERVISOR_RELAY_SNAPSHOT_CHANNEL, () => started.snapshot())
  started.start()
}
