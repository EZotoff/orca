#!/usr/bin/env node
// Live-send acceptance runner for Telegram file sharing (orca-transition
// plan Task 20). Standalone on purpose: it takes the bot token from argv —
// NEVER from the Orca credential store — so the acceptance run happens
// without wiring a GUI session. Usage:
//   node scripts/fileshare/telegram-live-send.mjs --token <botToken> --chat <chatId> --file <path> [--file <path>...]
import { openAsBlob, statSync } from 'node:fs'
import { basename } from 'node:path'
import { argv, exit } from 'node:process'

const LIMIT_BYTES = 50 * 1024 * 1024

function parseArgs(args) {
  const out = { token: '', chat: '', files: [] }
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (flag === '--token') out.token = value
    else if (flag === '--chat') out.chat = value
    else if (flag === '--file') out.files.push(value)
    else {
      console.error(`unknown flag: ${flag}`)
      exit(2)
    }
  }
  return out
}

function redact(text, token) {
  return text.split(token).join('[redacted]')
}

const { token, chat, files } = parseArgs(argv.slice(2))
if (token === undefined || chat === undefined || files.length === 0) {
  console.error('usage: telegram-live-send.mjs --token <botToken> --chat <chatId> --file <path> [--file <path>...]')
  exit(2)
}

let failures = 0
for (const file of files) {
  const info = statSync(file)
  if (!info.isFile()) {
    console.error(`SKIP (not a regular file): ${file}`)
    failures += 1
    continue
  }
  if (info.size > LIMIT_BYTES) {
    console.error(`SKIP (above Telegram 50 MB bot limit): ${file}`)
    failures += 1
    continue
  }
  const form = new FormData()
  form.append('chat_id', chat)
  form.append('document', await openAsBlob(file), basename(file))
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000)
    })
    const body = await response.text()
    if (response.ok) {
      console.log(`SENT ${file} → ${redact(body, token)}`)
    } else {
      console.error(`FAIL ${file} → HTTP ${response.status}: ${redact(body, token)}`)
      failures += 1
    }
  } catch (error) {
    console.error(`FAIL ${file} → ${redact(error instanceof Error ? error.message : String(error), token)}`)
    failures += 1
  }
}
exit(failures === 0 ? 0 : 1)
