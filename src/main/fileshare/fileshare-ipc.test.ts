// Credential validation gating for the fileshare IPC (orca-transition Task 20).
import { describe, expect, test, vi } from 'vitest'
import { validateCredentials } from './fileshare-ipc'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, dialog: {} }))

const VALID_TOKEN = '1234567890:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-4g'

describe('validateCredentials', () => {
  test('accepts a BotFather token with a numeric or @username chat id', () => {
    expect(validateCredentials(VALID_TOKEN, '-1001234567890')).toEqual({ ok: true })
    expect(validateCredentials(VALID_TOKEN, '@mychannel')).toEqual({ ok: true })
    expect(validateCredentials(VALID_TOKEN, '12345')).toEqual({ ok: true })
  })

  test('rejects malformed tokens and chat ids with distinct scalar errors', () => {
    expect(validateCredentials('not-a-token', '@mychannel')).toEqual({
      ok: false,
      error: 'invalid-token'
    })
    expect(validateCredentials(VALID_TOKEN, 'my channel')).toEqual({
      ok: false,
      error: 'invalid-chat-id'
    })
    expect(validateCredentials(VALID_TOKEN, '')).toEqual({ ok: false, error: 'invalid-chat-id' })
  })
})
