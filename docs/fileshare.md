# File sharing v1 — Telegram (orca-transition Task 20)

First target (operator decision, 2026-09-24): **Telegram via a simple bot** — the
explicit share action uploads selected files to a configured chat with the Bot API
[`sendDocument`](https://core.telegram.org/bot-api#senddocument). No new runtime
dependency: Node 24 built-in `fetch` + `FormData` + `openAsBlob` build the multipart
upload. The original design's clipboard file-list MIME path (design §7) remains a
possible follow-up target; the accepted v1 target is Telegram only.

## One-time setup

1. In Telegram, talk to **@BotFather** → `/newbot` → copy the bot token
   (shape `1234567890:AAE…`).
2. Get the chat id:
   - Direct chat with the bot: message the bot once (press Start), then open
     `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
     `result[].message.chat.id`.
   - Channel: add the bot as a channel admin; channel ids look like
     `-1001234567890` (or use `@channelusername` for public channels).
3. In Orca: **Settings → Accounts → File sharing (Telegram)** → paste the bot
   token and chat id → Save. The share button on the overview panel enables.

## Share flow

Overview panel → paper-plane button → main-process file picker (multi-select) →
per file: verified local readable regular file, ≤ 50 MB (Telegram bot cap) →
`sendDocument` upload → scalar outcome note (sent / partial / error labels).

## Security (binding)

- Sharing is an **explicit operator action only** — the only trigger is the
  share IPC invoke; there are no watchers, background sends, or auto-shares.
- The bot token lives only in the main process, sealed with Electron
  `safeStorage` (`~/.orca/fileshare-telegram-token.enc`, secure-file
  permissions; plaintext envelope only when safeStorage is unavailable).
- The renderer never receives the token: credential status is a boolean,
  credential input is one-way on save, share results are scalar enums +
  filenames (never absolute paths, never raw error text).
- The Telegram API URL embeds the token, so every error string passes through
  `redactToken` before crossing any boundary or being logged.
- Files are pre-verified: must exist, be a local readable regular file, and be
  within the 50 MB bot limit; nothing agent-produced or remote is ever read.

## Live-send acceptance runner

```bash
node scripts/fileshare/telegram-live-send.mjs --token <botToken> --chat <chatId> --file <path>
```

Exit 0 = every file delivered (prints the Telegram `message_id` response);
non-zero = at least one failure. The script takes the token from argv only —
it never reads the Orca credential store.
