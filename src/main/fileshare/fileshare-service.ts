// Share orchestration for Telegram file sharing (orca-transition plan Task
// 20). SECURITY (binding): sharing is an EXPLICIT operator action — this
// service only ever runs on the fileshare:share IPC invoke; nothing here
// scans, watches, or auto-sends. Files are pre-verified (exists, regular,
// readable via openAsBlob, ≤ Telegram's 50 MB bot cap) and every failure is
// a scalar enum + filename; absolute paths and raw error text (which embed
// the bot token in the URL) never reach the renderer.
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  FILESHARE_SCHEMA_VERSION,
  TELEGRAM_BOT_FILE_LIMIT_BYTES,
  type FileShareFileResult,
  type FileShareSendErrorCode,
  type FileShareSendOutcome
} from '../../shared/fileshare-types'
import type { TelegramCredentialStore } from './telegram-credential-store'
import { sendDocument, type TelegramFetchPort } from './telegram-send'

export type ShareDeps = {
  readonly credentials: TelegramCredentialStore
  readonly fetch: TelegramFetchPort
}

/** Validate one path; ok carries the byte size for the cap check. */
async function validateFile(
  filePath: string
): Promise<{ ok: true; size: number } | { ok: false; errorCode: FileShareSendErrorCode }> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(filePath)
  } catch {
    return { ok: false, errorCode: 'file-missing' }
  }
  if (!info.isFile()) {
    return { ok: false, errorCode: 'file-not-regular' }
  }
  if (info.size > TELEGRAM_BOT_FILE_LIMIT_BYTES) {
    return { ok: false, errorCode: 'file-too-large' }
  }
  return { ok: true, size: info.size }
}

export async function shareFiles(
  filePaths: readonly string[],
  deps: ShareDeps
): Promise<FileShareSendOutcome> {
  const credentials = deps.credentials.load()
  if (credentials === null) {
    return {
      schemaVersion: FILESHARE_SCHEMA_VERSION,
      status: 'error',
      errorCode: 'not-configured',
      results: []
    }
  }
  const results: FileShareFileResult[] = []
  for (const filePath of filePaths) {
    const validation = await validateFile(filePath)
    if (!validation.ok) {
      results.push({ fileName: basename(filePath), ok: false, errorCode: validation.errorCode })
      continue
    }
    const sent = await sendDocument({ ...credentials, filePath }, deps.fetch)
    results.push(
      sent.ok
        ? { fileName: basename(filePath), ok: true }
        : {
            fileName: basename(filePath),
            ok: false,
            errorCode: sent.errorCode,
            retryAfterSeconds: sent.retryAfterSeconds
          }
    )
  }
  const sentCount = results.filter((result) => result.ok).length
  const status = sentCount === 0 ? 'error' : sentCount === results.length ? 'sent' : 'partial'
  return { schemaVersion: FILESHARE_SCHEMA_VERSION, status, results }
}
