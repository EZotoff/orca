// Settings entry for Telegram file sharing (orca-transition plan Task 20).
// Self-contained: token + chat id drafts go one-way into the main-process
// credential store; only a configured boolean ever comes back. The stored
// bot token is never displayed — an empty draft means "keep existing".
import { useEffect, useState } from 'react'
import { SendIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

const SETUP_HINT =
  'Create a bot with @BotFather, send it one message (or add it to the chat), then paste the bot token and chat id here. Docs: docs/fileshare.md.'

export function FileShareSettingsSection(): React.JSX.Element {
  const [configured, setConfigured] = useState(false)
  const [botTokenDraft, setBotTokenDraft] = useState('')
  const [chatIdDraft, setChatIdDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void window.api.fileShare
      .getStatus()
      .then((status) => {
        if (!disposed) {
          setConfigured(status.configured)
        }
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const outcome = await window.api.fileShare.saveCredentials(botTokenDraft, chatIdDraft)
      if (outcome.ok) {
        setConfigured(true)
        setBotTokenDraft('')
        setNote('Saved')
      } else {
        setNote(outcome.error === 'invalid-token' ? 'Invalid bot token' : 'Invalid chat id')
      }
    } catch {
      setNote('Could not save credentials')
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const status = await window.api.fileShare.clearCredentials()
      setConfigured(status.configured)
      setNote('Cleared')
    } catch {
      setNote('Could not clear credentials')
    } finally {
      setBusy(false)
    }
  }

  const canSave = !busy && botTokenDraft !== '' && chatIdDraft !== ''

  return (
    <section id="accounts-fileshare" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <SendIcon className="size-4" />
          File sharing (Telegram)
        </h3>
        <p className="text-xs text-muted-foreground">{SETUP_HINT}</p>
      </div>
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="space-y-1.5">
          <Label htmlFor="fileshare-bot-token">Bot token</Label>
          <Input
            id="fileshare-bot-token"
            type="password"
            autoComplete="off"
            placeholder={configured ? 'Stored — enter a new token to replace' : '123456:ABC-DEF…'}
            value={botTokenDraft}
            onChange={(event) => setBotTokenDraft(event.target.value)}
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fileshare-chat-id">Chat id</Label>
          <Input
            id="fileshare-chat-id"
            type="text"
            autoComplete="off"
            placeholder={configured ? 'Stored — enter a new chat id to replace' : '-1001234567890 or @channel'}
            value={chatIdDraft}
            onChange={(event) => setChatIdDraft(event.target.value)}
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => void save()} disabled={!canSave}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void clear()}
            disabled={busy || !configured}
          >
            Clear
          </Button>
          <span className="text-xs text-muted-foreground">
            {note ?? (configured ? 'Configured' : 'Not configured — share action disabled')}
          </span>
        </div>
      </div>
    </section>
  )
}
