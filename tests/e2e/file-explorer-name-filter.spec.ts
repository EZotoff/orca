import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: useRuntimeFileListForWorktree scopes listings/loading to a request key so a
// query change never shows the previous listing or a stale "no results" flash.
// Unit tests pin the intermediate hook renders; these specs pin the user-visible
// wiring (filter input -> rows / "No files match this filter") against regressions.
function rowByName(explorer: Locator, page: Page, name: string): Locator {
  return explorer
    .locator('[data-file-explorer-row]')
    .filter({ has: page.locator('[data-file-explorer-row-name]', { hasText: name }) })
}

test('name filter narrows to the matching file', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const explorer = orcaPage.locator('[data-orca-explorer-shell]')
  await expect(explorer).toBeVisible({ timeout: 10_000 })
  const input = orcaPage.getByPlaceholder('Find files')
  await expect(input).toBeVisible({ timeout: 10_000 })

  await input.fill('package.')
  await expect(rowByName(explorer, orcaPage, 'package.json').first()).toBeVisible({
    timeout: 10_000
  })
  await expect(rowByName(explorer, orcaPage, 'README.md')).toHaveCount(0)
})

test('name filter shows the empty message only for a true no-match', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const explorer = orcaPage.locator('[data-orca-explorer-shell]')
  await expect(explorer).toBeVisible({ timeout: 10_000 })
  const input = orcaPage.getByPlaceholder('Find files')
  await expect(input).toBeVisible({ timeout: 10_000 })

  await input.fill('zz-no-such-file-12345')
  await expect(explorer.getByText('No files match this filter')).toBeVisible({ timeout: 10_000 })

  await input.fill('')
  await expect(rowByName(explorer, orcaPage, 'README.md').first()).toBeVisible({
    timeout: 10_000
  })
})

test('rapid filter changes converge on the latest query', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const explorer = orcaPage.locator('[data-orca-explorer-shell]')
  await expect(explorer).toBeVisible({ timeout: 10_000 })
  const input = orcaPage.getByPlaceholder('Find files')
  await expect(input).toBeVisible({ timeout: 10_000 })

  // Why: this seeded worktree is local, so one listing serves every query and no
  // per-query request exists to race; the remote race is pinned by the hook unit
  // tests. This only proves back-to-back edits converge on the latest query.
  await input.fill('package.')
  await input.fill('README')
  await expect(rowByName(explorer, orcaPage, 'README.md').first()).toBeVisible({
    timeout: 10_000
  })
  await expect(rowByName(explorer, orcaPage, 'package.json')).toHaveCount(0)
  await expect(explorer.getByText('No files match this filter')).toHaveCount(0)

  // Reverse direction: matching -> no-match -> matching must also converge.
  await input.fill('zz-no-such-file-12345')
  await expect(explorer.getByText('No files match this filter')).toBeVisible({ timeout: 10_000 })
  await expect(explorer.locator('[data-file-explorer-row]')).toHaveCount(0)
  await input.fill('package.')
  await expect(rowByName(explorer, orcaPage, 'package.json').first()).toBeVisible({
    timeout: 10_000
  })
  await expect(explorer.getByText('No files match this filter')).toHaveCount(0)
})
