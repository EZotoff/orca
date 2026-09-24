// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileShareControl } from './FileShareControl'
import type { FileShareSendOutcome } from '../../../../shared/fileshare-types'

type ShareMock = typeof window.api.fileShare.share

function stubFileShareApi(configured: boolean, share: ShareMock): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    fileShare: {
      getStatus: async () => ({ configured }),
      saveCredentials: async () => ({ ok: true }),
      clearCredentials: async () => ({ configured: false }),
      share
    }
  }
}

const sentOutcome: FileShareSendOutcome = {
  schemaVersion: 1,
  status: 'sent',
  results: [{ fileName: 'report.pdf', ok: true }]
}

describe('FileShareControl', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders disabled with a configure tooltip when the target is unconfigured', async () => {
    stubFileShareApi(false, vi.fn())
    const { findByTitle } = render(<FileShareControl />)
    const button = await findByTitle(/not configured/i)
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('invokes the explicit share action on click and reports the scalar outcome', async () => {
    const share = vi.fn().mockResolvedValue(sentOutcome)
    stubFileShareApi(true, share)
    const { findByTitle, findByText } = render(<FileShareControl />)
    const button = await findByTitle('Share files to Telegram')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(share).toHaveBeenCalledTimes(1)
    await findByText('Sent 1 file to Telegram')
  })

  it('renders the fixed too-large label for a size-cap refusal', async () => {
    const share = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      status: 'error',
      results: [{ fileName: 'big.bin', ok: false, errorCode: 'file-too-large' }]
    } satisfies FileShareSendOutcome)
    stubFileShareApi(true, share)
    const { findByTitle, findByText } = render(<FileShareControl />)
    fireEvent.click(await findByTitle('Share files to Telegram'))
    await findByText('File exceeds Telegram 50 MB bot limit')
  })
})
