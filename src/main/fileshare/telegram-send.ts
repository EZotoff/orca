// Telegram Bot API sendDocument (orca-transition plan Task 20). Plain
// fetch + FormData/Blob (Node 24 built-ins — no new dependency). The API URL
// embeds the bot token, so EVERY error string passes through redactToken
// before it is returned; callers must only ever surface the redacted text.
import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'
import type { FileShareSendErrorCode } from '../../shared/fileshare-types'
import { TELEGRAM_BOT_FILE_LIMIT_BYTES } from '../../shared/fileshare-types'

const TELEGRAM_API_BASE = 'https://api.telegram.org'
const SEND_TIMEOUT_MS = 120_000

export type TelegramSendRequest = {
  readonly botToken: string
  readonly chatId: string
  readonly filePath: string
}

export type TelegramSendFailure = {
  readonly ok: false
  readonly errorCode: FileShareSendErrorCode
  readonly redactedDetail: string
  readonly retryAfterSeconds?: number
}

export type TelegramSendSuccess = { readonly ok: true; readonly messageId: number }

export type TelegramSendResult = TelegramSendSuccess | TelegramSendFailure

export type TelegramFetchPort = (
  input: string,
  init: RequestInit
) => Promise<{ readonly status: number; readonly text: () => Promise<string> }>

const responseBodySchema = z.object({
  ok: z.boolean().optional(),
  result: z.object({ message_id: z.number() }).passthrough().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().nonnegative() }).optional()
})

/** Replace every occurrence of the token before text crosses any boundary (the URL embeds it). */
export function redactToken(text: string, token: string): string {
  if (token === '') {
    return text
  }
  return text.split(token).join('[redacted]')
}

export function sendDocumentUrl(botToken: string): string {
  return `${TELEGRAM_API_BASE}/bot${botToken}/sendDocument`
}

/** Build the multipart form for one file; exported for payload-correctness tests. */
export async function buildSendDocumentForm(
  chatId: string,
  filePath: string
): Promise<{ form: FormData; fileName: string; size: number }> {
  const blob = await openAsBlob(filePath)
  const form = new FormData()
  form.append('chat_id', chatId)
  const fileName = basename(filePath)
  form.append('document', blob, fileName)
  return { form, fileName, size: blob.size }
}

function mapStatusToErrorCode(status: number): FileShareSendErrorCode {
  if (status === 401) {
    return 'unauthorized'
  }
  if (status === 429) {
    return 'rate-limited'
  }
  if (status === 400) {
    return 'bad-request'
  }
  if (status >= 500) {
    return 'server-error'
  }
  return 'unknown'
}

export async function sendDocument(
  request: TelegramSendRequest,
  fetchPort: TelegramFetchPort = globalThis.fetch.bind(globalThis)
): Promise<TelegramSendResult> {
  if (request.botToken === '' || request.chatId === '') {
    return { ok: false, errorCode: 'not-configured', redactedDetail: 'credentials missing' }
  }
  let form: FormData
  try {
    ;({ form } = await buildSendDocumentForm(request.chatId, request.filePath))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, errorCode: 'file-unreadable', redactedDetail: redactToken(detail, request.botToken) }
  }
  let response: Awaited<ReturnType<TelegramFetchPort>>
  try {
    response = await fetchPort(sendDocumentUrl(request.botToken), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    })
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError'
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      errorCode: isTimeout ? 'timeout' : 'network',
      redactedDetail: redactToken(detail, request.botToken)
    }
  }
  const rawBody = await response.text().catch(() => '')
  const body = responseBodySchema.safeParse(
    rawBody === '' ? {} : (() => { try { return JSON.parse(rawBody) } catch { return {} } })()
  )
  const parsed = body.success ? body.data : {}
  if (response.status === 200 && parsed.ok === true && parsed.result !== undefined) {
    return { ok: true, messageId: parsed.result.message_id }
  }
  const errorCode = mapStatusToErrorCode(response.status)
  return {
    ok: false,
    errorCode,
    redactedDetail: redactToken(parsed.description ?? `HTTP ${response.status}`, request.botToken),
    retryAfterSeconds:
      errorCode === 'rate-limited' && parsed.parameters !== undefined
        ? parsed.parameters.retry_after
        : undefined
  }
}

export { TELEGRAM_BOT_FILE_LIMIT_BYTES }
