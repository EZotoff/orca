// File sharing v1 renderer boundary types (orca-transition plan Task 20).
//
// The operator picked Telegram as the first target (2026-09-24): the explicit
// share action delivers selected local files to a configured chat via the
// Bot API `sendDocument`. Trust boundary follows the supervisor-relay house
// style: the bot token and chat id live ONLY in the main process; renderers
// get a boolean configured-status, send credentials in (one way, on save),
// and receive scalar enum outcomes back — never the token, never absolute
// paths, never raw network error text (the Telegram URL embeds the token,
// so every error is redacted in main before it crosses the bridge).
export const FILESHARE_SCHEMA_VERSION = 1

export const FILESHARE_STATUS_CHANNEL = 'fileshare:getStatus'
export const FILESHARE_SAVE_CREDENTIALS_CHANNEL = 'fileshare:saveCredentials'
export const FILESHARE_CLEAR_CREDENTIALS_CHANNEL = 'fileshare:clearCredentials'
export const FILESHARE_SHARE_CHANNEL = 'fileshare:share'

/** Credential validity; scalar — the renderer never learns why beyond this enum. */
export type FileShareCredentialError = 'invalid-token' | 'invalid-chat-id'

export type FileShareCredentialSaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: FileShareCredentialError }

/** Per-file scalar result; fileName only, never the absolute path. */
export type FileShareFileResult = {
  readonly fileName: string
  readonly ok: boolean
  readonly errorCode?: FileShareSendErrorCode
  /** Seconds Telegram asked us to wait (429 retry_after), surfaced for the UI note. */
  readonly retryAfterSeconds?: number
}

export type FileShareSendErrorCode =
  | 'not-configured'
  | 'file-missing'
  | 'file-not-regular'
  | 'file-unreadable'
  | 'file-too-large'
  | 'network'
  | 'timeout'
  | 'rate-limited'
  | 'unauthorized'
  | 'bad-request'
  | 'server-error'
  | 'unknown'

export type FileShareSendOutcome = {
  readonly schemaVersion: typeof FILESHARE_SCHEMA_VERSION
  /** sent: all delivered; partial: some delivered; cancelled: picker dismissed; error: nothing delivered. */
  readonly status: 'sent' | 'partial' | 'cancelled' | 'error'
  /** Present only when status is error and nothing was attempted (unconfigured share target). */
  readonly errorCode?: FileShareSendErrorCode
  readonly results: readonly FileShareFileResult[]
}

/** Telegram bot upload cap (Bot API sendDocument). */
export const TELEGRAM_BOT_FILE_LIMIT_BYTES = 50 * 1024 * 1024
