// Task 20 battery: multipart payload correctness, credential gating, size
// cap, network-error mapping (timeout / 4xx / 429 retry-after), and token
// redaction — the token must never survive into any returned error text.
import { describe, expect, test, vi } from 'vitest'
import { closeSync, ftruncateSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSendDocumentForm, redactToken, sendDocument } from './telegram-send'
import { shareFiles } from './fileshare-service'
import { TelegramCredentialStore } from './telegram-credential-store'
import type { TelegramFetchPort } from './telegram-send'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`sealed:${plaintext}`, 'utf8'),
    decryptString: (sealed: Buffer) => sealed.toString('utf8').replace('sealed:', '')
  }
}))

const TOKEN = '1234567890:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-4g'
const CHAT = '-1001234567890'

function tempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-fileshare-'))
  const path = join(dir, name)
  writeFileSync(path, contents, 'utf8')
  return path
}

const okResponse = (messageId = 42) => ({
  status: 200,
  text: async () => JSON.stringify({ ok: true, result: { message_id: messageId } })
})

describe('buildSendDocumentForm', () => {
  test('multipart form carries chat_id and the file as document', async () => {
    const path = tempFile('report.txt', 'hello attachment')
    const { form, fileName, size } = await buildSendDocumentForm(CHAT, path)
    expect(fileName).toBe('report.txt')
    expect(size).toBe('hello attachment'.length)
    expect(form.get('chat_id')).toBe(CHAT)
    const document = form.get('document')
    expect(document).toBeInstanceOf(Blob)
    expect((document as File).name).toBe('report.txt')
  })
})

describe('redactToken', () => {
  test('every token occurrence is replaced, including inside URLs', () => {
    const url = `https://api.telegram.org/bot${TOKEN}/sendDocument`
    expect(redactToken(url, TOKEN)).toBe('https://api.telegram.org/bot[redacted]/sendDocument')
    expect(redactToken(`${TOKEN} ${TOKEN}`, TOKEN)).toBe('[redacted] [redacted]')
  })
})

describe('sendDocument error mapping', () => {
  const request = (path: string) => ({ botToken: TOKEN, chatId: CHAT, filePath: path })

  test('success', async () => {
    const path = tempFile('a.txt', 'x')
    const result = await sendDocument(request(path), async () => okResponse())
    expect(result).toEqual({ ok: true, messageId: 42 })
  })

  test('timeout maps to timeout with redacted detail', async () => {
    const path = tempFile('a.txt', 'x')
    const timeoutError = new Error(`fetch failed for ${TOKEN}`)
    timeoutError.name = 'TimeoutError'
    const result = await sendDocument(request(path), async () => {
      throw timeoutError
    })
    expect(result).toMatchObject({ ok: false, errorCode: 'timeout' })
    expect((result as { redactedDetail: string }).redactedDetail).not.toContain(TOKEN)
  })

  test('429 maps to rate-limited with retry_after seconds', async () => {
    const path = tempFile('a.txt', 'x')
    const result = await sendDocument(request(path), async () => ({
      status: 429,
      text: async () =>
        JSON.stringify({ ok: false, description: `Too Many Requests for ${TOKEN}`, parameters: { retry_after: 27 } })
    }))
    expect(result).toMatchObject({ ok: false, errorCode: 'rate-limited', retryAfterSeconds: 27 })
    expect((result as { redactedDetail: string }).redactedDetail).not.toContain(TOKEN)
  })

  test('401 maps to unauthorized, 400 to bad-request, 502 to server-error', async () => {
    const path = tempFile('a.txt', 'x')
    for (const [status, errorCode] of [
      [401, 'unauthorized'],
      [400, 'bad-request'],
      [502, 'server-error']
    ] as const) {
      const result = await sendDocument(request(path), async () => ({
        status,
        text: async () => JSON.stringify({ ok: false, description: 'nope' })
      }))
      expect(result).toMatchObject({ ok: false, errorCode })
    }
  })

  test('unreadable file maps to file-unreadable without attempting the upload', async () => {
    let calls = 0
    const fetch: TelegramFetchPort = async () => {
      calls += 1
      return okResponse()
    }
    const result = await sendDocument(
      { botToken: TOKEN, chatId: CHAT, filePath: '/nonexistent/file.txt' },
      fetch
    )
    expect(result).toMatchObject({ ok: false, errorCode: 'file-unreadable' })
    expect(calls).toBe(0)
  })
})

describe('shareFiles', () => {
  function storeWithCredentials(): TelegramCredentialStore {
    const dir = mkdtempSync(join(tmpdir(), 'orca-fileshare-store-'))
    const store = new TelegramCredentialStore(dir)
    store.save({ botToken: TOKEN, chatId: CHAT })
    return store
  }

  function emptyStore(): TelegramCredentialStore {
    return new TelegramCredentialStore(mkdtempSync(join(tmpdir(), 'orca-fileshare-empty-')))
  }

  test('unconfigured credentials gate the share — no upload attempted', async () => {
    let calls = 0
    const fetch: TelegramFetchPort = async () => {
      calls += 1
      return okResponse()
    }
    const outcome = await shareFiles([tempFile('a.txt', 'x')], { credentials: emptyStore(), fetch })
    expect(outcome.status).toBe('error')
    expect(outcome.errorCode).toBe('not-configured')
    expect(calls).toBe(0)
  })

  test('file above the 50 MB bot cap is refused before upload', async () => {
    let calls = 0
    const fetch: TelegramFetchPort = async () => {
      calls += 1
      return okResponse()
    }
    const tooBig = join(mkdtempSync(join(tmpdir(), 'orca-fileshare-big-')), 'big.bin')
    const hole = openSync(tooBig, 'w')
    ftruncateSync(hole, 50 * 1024 * 1024 + 1)
    closeSync(hole)
    const outcome = await shareFiles([tooBig], { credentials: storeWithCredentials(), fetch })
    expect(outcome.status).toBe('error')
    expect(outcome.results[0]).toMatchObject({ fileName: 'big.bin', ok: false, errorCode: 'file-too-large' })
    expect(calls).toBe(0)
  })

  test('missing and non-regular files map to scalar errors; successes report filenames only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-fileshare-mixed-'))
    const good = join(dir, 'good.txt')
    writeFileSync(good, 'payload', 'utf8')
    const outcome = await shareFiles([good, '/nonexistent/x.txt', dir], {
      credentials: storeWithCredentials(),
      fetch: async () => okResponse()
    })
    expect(outcome.status).toBe('partial')
    expect(outcome.results).toEqual([
      { fileName: 'good.txt', ok: true },
      { fileName: 'x.txt', ok: false, errorCode: 'file-missing' },
      { fileName: expect.stringContaining('orca-fileshare-mixed-'), ok: false, errorCode: 'file-not-regular' }
    ])
  })

  test('the serialized outcome never contains the bot token', async () => {
    const failing: TelegramFetchPort = async () => ({
      status: 429,
      text: async () => JSON.stringify({ ok: false, description: TOKEN, parameters: { retry_after: 5 } })
    })
    const path = tempFile('secret-check.txt', 'x')
    const outcome = await shareFiles([path], { credentials: storeWithCredentials(), fetch: failing })
    expect(JSON.stringify(outcome)).not.toContain(TOKEN)
  })
})
