import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  FILESHARE_CLEAR_CREDENTIALS_CHANNEL,
  FILESHARE_SAVE_CREDENTIALS_CHANNEL,
  FILESHARE_SHARE_CHANNEL,
  FILESHARE_STATUS_CHANNEL
} from '../../shared/fileshare-types'

export const fileShareApi = {
  getStatus: () => ipcRenderer.invoke(FILESHARE_STATUS_CHANNEL),
  saveCredentials: (botToken: string, chatId: string) =>
    ipcRenderer.invoke(FILESHARE_SAVE_CREDENTIALS_CHANNEL, { botToken, chatId }),
  clearCredentials: () => ipcRenderer.invoke(FILESHARE_CLEAR_CREDENTIALS_CHANNEL),
  share: () => ipcRenderer.invoke(FILESHARE_SHARE_CHANNEL)
} satisfies PreloadApi['fileShare']
