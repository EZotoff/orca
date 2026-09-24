import { ipcRenderer } from 'electron'
import type { SupervisorRelayFocusOutcome, SupervisorRelayPayload } from '../../shared/supervisor-relay-types'
import type { PreloadApi } from '../api-types'

export const supervisorRelayApi = {
  onUpdate: (callback: (payload: SupervisorRelayPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SupervisorRelayPayload) =>
      callback(payload)
    ipcRenderer.on('supervisorRelay:update', listener)
    return () => ipcRenderer.removeListener('supervisorRelay:update', listener)
  },
  getSnapshot: (): Promise<SupervisorRelayPayload> =>
    ipcRenderer.invoke('supervisorRelay:getSnapshot'),
  focus: (cardId: string): Promise<SupervisorRelayFocusOutcome> =>
    ipcRenderer.invoke('supervisorRelay:focus', cardId)
} satisfies PreloadApi['supervisorRelay']
