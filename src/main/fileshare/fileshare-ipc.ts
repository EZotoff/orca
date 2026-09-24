// Electron wiring for Telegram file sharing (orca-transition plan Task 20).
// Same privileged-boundary shape as the supervisor relay: credentials live in
// main (safeStorage-sealed file), the renderer only ever receives a boolean
// configured-status, credential input arrives one-way on save, and the share
// invoke runs file selection (main-side dialog) + upload entirely in main,
// returning scalar outcomes. The share is only ever triggered by this IPC —
// nothing registers watchers or background sends.
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  FILESHARE_CLEAR_CREDENTIALS_CHANNEL,
  FILESHARE_SAVE_CREDENTIALS_CHANNEL,
  FILESHARE_SHARE_CHANNEL,
  FILESHARE_STATUS_CHANNEL,
  FILESHARE_SCHEMA_VERSION,
  type FileShareCredentialSaveOutcome,
  type FileShareSendOutcome
} from '../../shared/fileshare-types'
import { TelegramCredentialStore, defaultFileShareDir } from './telegram-credential-store'
import { shareFiles } from './fileshare-service'
import type { TelegramFetchPort } from './telegram-send'

/** BotFather token shape: `<numeric id>:<base64url secret>`. */
const BOT_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/
/** Numeric chat/channel ids (negative groups/channels) or @public usernames. */
const CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$/

const credentialInputSchema = z.object({ botToken: z.string(), chatId: z.string() })

export function validateCredentials(
  botToken: string,
  chatId: string
): FileShareCredentialSaveOutcome {
  if (!BOT_TOKEN_PATTERN.test(botToken)) {
    return { ok: false, error: 'invalid-token' }
  }
  if (!CHAT_ID_PATTERN.test(chatId)) {
    return { ok: false, error: 'invalid-chat-id' }
  }
  return { ok: true }
}

/** Main-side file picker; injectable so tests drive shareFiles without a dialog. */
export type FilePickerPort = () => Promise<readonly string[] | undefined>

function defaultFilePicker(): FilePickerPort {
  return async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Share files to Telegram'
    })
    return picked.canceled ? undefined : picked.filePaths
  }
}

export function registerFileShareIpc(options: {
  readonly store?: TelegramCredentialStore
  readonly fetch?: TelegramFetchPort
  readonly picker?: FilePickerPort
} = {}): void {
  const store = options.store ?? new TelegramCredentialStore(defaultFileShareDir())
  const fetch: TelegramFetchPort = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const picker = options.picker ?? defaultFilePicker()
  ipcMain.handle(FILESHARE_STATUS_CHANNEL, () => ({ configured: store.hasCredentials() }))
  ipcMain.handle(
    FILESHARE_SAVE_CREDENTIALS_CHANNEL,
    (_event, value: unknown): FileShareCredentialSaveOutcome => {
      if (typeof value !== 'object' || value === null) {
        return { ok: false, error: 'invalid-token' }
      }
      const parsed = credentialInputSchema.safeParse(value)
      if (!parsed.success) {
        return { ok: false, error: 'invalid-token' }
      }
      const botToken = parsed.data.botToken.trim()
      const chatId = parsed.data.chatId.trim()
      const validation = validateCredentials(botToken, chatId)
      if (!validation.ok) {
        return validation
      }
      store.save({ botToken, chatId })
      return { ok: true }
    }
  )
  ipcMain.handle(FILESHARE_CLEAR_CREDENTIALS_CHANNEL, () => {
    store.clear()
    return { configured: store.hasCredentials() }
  })
  ipcMain.handle(FILESHARE_SHARE_CHANNEL, async (): Promise<FileShareSendOutcome> => {
    const paths = await picker()
    if (paths === undefined || paths.length === 0) {
      return { schemaVersion: FILESHARE_SCHEMA_VERSION, status: 'cancelled', results: [] }
    }
    return shareFiles(paths, { credentials: store, fetch })
  })
}
