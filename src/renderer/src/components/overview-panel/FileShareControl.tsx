// Overview-panel share action for Telegram file sharing (orca-transition
// plan Task 20). EXPLICIT operator action only: the button invokes the
// main-side picker + upload and renders scalar outcomes. Unconfigured →
// disabled with a tooltip pointing at Settings → Accounts → File sharing.
import { useEffect, useState } from 'react'
import { SendIcon } from 'lucide-react'
import type { FileShareSendOutcome } from '../../../../shared/fileshare-types'
import { translate } from '@/i18n/i18n'

const UNCONFIGURED_TOOLTIP =
  'Telegram sharing is not configured — Settings → Accounts → File sharing'

const ERROR_LABELS: Record<string, string> = {
  'not-configured': 'Sharing not configured',
  'file-missing': 'File not found',
  'file-not-regular': 'Not a regular file',
  'file-unreadable': 'File unreadable',
  'file-too-large': 'File exceeds Telegram 50 MB bot limit',
  network: 'Network error',
  timeout: 'Timed out',
  'rate-limited': 'Rate limited by Telegram',
  unauthorized: 'Bot token rejected',
  'bad-request': 'Telegram rejected the request',
  'server-error': 'Telegram server error',
  unknown: 'Share failed'
}

function outcomeNote(outcome: FileShareSendOutcome): string {
  if (outcome.status === 'cancelled') {
    return 'Share cancelled'
  }
  const sent = outcome.results.filter((result) => result.ok).length
  if (outcome.status === 'sent') {
    return `Sent ${sent} file${sent === 1 ? '' : 's'} to Telegram`
  }
  const failed = outcome.results.find((result) => !result.ok)
  const failedLabel =
    failed !== undefined && failed.errorCode !== undefined
      ? (ERROR_LABELS[failed.errorCode] ?? ERROR_LABELS['unknown'])
      : ERROR_LABELS['unknown']
  if (outcome.status === 'error' && outcome.errorCode === 'not-configured') {
    return ERROR_LABELS['not-configured']
  }
  return outcome.status === 'partial'
    ? `Sent ${sent}; failed: ${failedLabel}`
    : failedLabel
}

export function FileShareControl(): React.JSX.Element {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined)
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
      .catch(() => {
        if (!disposed) {
          setConfigured(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [])

  const share = async (): Promise<void> => {
    setNote('Sharing…')
    try {
      const outcome = await window.api.fileShare.share()
      setNote(outcomeNote(outcome))
    } catch {
      setNote('Share failed')
    }
  }

  return (
    <span className="flex items-center gap-1.5" data-overview-fileshare="">
      {note !== null ? (
        <span className="max-w-40 truncate text-[11px] text-muted-foreground" data-overview-fileshare-note="">
          {note}
        </span>
      ) : null}
      <button
        type="button"
        data-overview-fileshare-button=""
        title={
          configured === false
            ? UNCONFIGURED_TOOLTIP
            : translate('overviewPanel.shareFiles', 'Share files to Telegram')
        }
        aria-label={translate('overviewPanel.shareFiles', 'Share files to Telegram')}
        disabled={configured !== true}
        onClick={() => void share()}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
      >
        <SendIcon className="size-3.5" />
      </button>
    </span>
  )
}
