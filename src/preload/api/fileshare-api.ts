import type {
  FileShareCredentialSaveOutcome,
  FileShareSendOutcome
} from '../../shared/fileshare-types'

export type FileShareApi = {
  /** Boolean only — the bot token never crosses back to the renderer. */
  getStatus: () => Promise<{ configured: boolean }>
  /** One-way credential input (Settings → main); scalar validity outcome. */
  saveCredentials: (botToken: string, chatId: string) => Promise<FileShareCredentialSaveOutcome>
  clearCredentials: () => Promise<{ configured: boolean }>
  /** Explicit share action: main opens the picker and performs the upload. */
  share: () => Promise<FileShareSendOutcome>
}
