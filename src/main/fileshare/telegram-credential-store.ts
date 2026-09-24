// Main-process credential store for Telegram file sharing (Task 20). The bot
// token is a secret: it is held ONLY here (main process), persisted via the
// safeStorage envelope + secure-file pattern used for the MiniMax API key,
// and never crosses the preload bridge. The chat id is not secret and lives
// in a plain JSON file beside it. A corrupt/undecryptable image loads as
// unconfigured rather than poisoning the share action.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { writeSecureFile } from '../../shared/secure-file'
import { z } from 'zod'

const TOKEN_FILE = 'fileshare-telegram-token.enc'
const CHAT_ID_FILE = 'fileshare-telegram-chat.json'
const ENVELOPE_PREFIX = 'orca-fileshare-telegram-token:v1:'

const chatIdFileSchema = z.object({ chatId: z.string() }).passthrough()

export type TelegramCredentials = {
  readonly botToken: string
  readonly chatId: string
}

export function defaultFileShareDir(): string {
  const override = process.env['ORCA_FILESHARE_DIR']
  if (override !== undefined && override !== '') {
    return override
  }
  return join(homedir(), '.orca')
}

function encodeEnvelope(kind: 'encrypted' | 'plaintext', payload: Buffer): string {
  return `${ENVELOPE_PREFIX}${kind}:${payload.toString('base64')}`
}

function decodeEnvelope(raw: Buffer): { kind: 'encrypted' | 'plaintext'; payload: Buffer } {
  const text = raw.toString('utf8')
  if (!text.startsWith(ENVELOPE_PREFIX)) {
    throw new Error('Telegram bot token could not be decrypted')
  }
  const rest = text.slice(ENVELOPE_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator === -1) {
    throw new Error('Telegram bot token could not be decrypted')
  }
  const kind = rest.slice(0, separator)
  if (kind !== 'encrypted' && kind !== 'plaintext') {
    throw new Error('Telegram bot token could not be decrypted')
  }
  return { kind, payload: Buffer.from(rest.slice(separator + 1), 'base64') }
}

export class TelegramCredentialStore {
  constructor(private readonly dir: string = defaultFileShareDir()) {}

  hasCredentials(): boolean {
    return existsSync(this.tokenPath()) && this.readChatId() !== null
  }

  load(): TelegramCredentials | null {
    const chatId = this.readChatId()
    if (chatId === null || !existsSync(this.tokenPath())) {
      return null
    }
    try {
      const envelope = decodeEnvelope(readFileSync(this.tokenPath()))
      const token =
        envelope.kind === 'plaintext'
          ? envelope.payload.toString('utf8')
          : safeStorage.decryptString(envelope.payload)
      if (token === '') {
        return null
      }
      return { botToken: token, chatId }
    } catch {
      // Undecryptable image: treat as unconfigured; never let the sealed
      // material escape through an error path.
      return null
    }
  }

  save(credentials: TelegramCredentials): void {
    mkdirSync(this.dir, { recursive: true })
    if (safeStorage.isEncryptionAvailable()) {
      writeSecureFile(
        this.tokenPath(),
        encodeEnvelope('encrypted', safeStorage.encryptString(credentials.botToken))
      )
    } else {
      writeSecureFile(
        this.tokenPath(),
        encodeEnvelope('plaintext', Buffer.from(credentials.botToken, 'utf8'))
      )
    }
    writeFileSync(this.chatIdPath(), JSON.stringify({ schemaVersion: 1, chatId: credentials.chatId }, null, 2), 'utf8')
  }

  clear(): void {
    if (existsSync(this.tokenPath())) {
      writeSecureFile(this.tokenPath(), '')
    }
    if (existsSync(this.chatIdPath())) {
      writeSecureFile(this.chatIdPath(), '')
    }
  }

  private tokenPath(): string {
    return join(this.dir, TOKEN_FILE)
  }

  private chatIdPath(): string {
    return join(this.dir, CHAT_ID_FILE)
  }

  private readChatId(): string | null {
    try {
      const parsed = chatIdFileSchema.safeParse(JSON.parse(readFileSync(this.chatIdPath(), 'utf8')))
      return parsed.success && parsed.data.chatId !== '' ? parsed.data.chatId : null
    } catch {
      return null
    }
  }
}
