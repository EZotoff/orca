import type { BrowserTabSwitchResult } from '../../shared/runtime-types'
import { BrowserError } from './cdp-bridge'
import { AgentBrowserBridgeShutdown } from './agent-browser-bridge-shutdown'
import { ORCA_TAB_SESSION_PREFIX } from './agent-browser-orphan-sweep'
import type {
  EnqueueTargetedCommandOptions,
  ResolvedBrowserCommandTarget
} from './agent-browser-bridge-types'

export abstract class AgentBrowserBridgeQueue extends AgentBrowserBridgeShutdown {
  // Why: route tab switch through the command queue so it can't race in-flight commands targeting the old tab.
  async tabSwitch(
    index: number | undefined,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserTabSwitchResult> {
    return this.enqueueCommand(worktreeId, async () => {
      const tabs = this.getRegisteredTabs(worktreeId)
      // Why: queue delay can change the tab list before execution — recompute against live webContents so no vanished index is activated.
      const liveEntries = [...tabs.entries()].filter(([, wcId]) => this.getWebContents(wcId))
      let switchedIndex = index ?? -1
      let resolvedPageId = browserPageId
      if (resolvedPageId) {
        switchedIndex = liveEntries.findIndex(([tabId]) => tabId === resolvedPageId)
      }
      if (switchedIndex < 0 || switchedIndex >= liveEntries.length) {
        const targetLabel =
          resolvedPageId != null ? `Browser page ${resolvedPageId}` : `Tab index ${index}`
        throw new BrowserError(
          'browser_tab_not_found',
          `${targetLabel} out of range (0-${liveEntries.length - 1})`
        )
      }
      const [tabId, wcId] = liveEntries[switchedIndex]
      this.activeWebContentsId = wcId
      // Why: resolveActiveTab prefers the per-worktree map, so update it or later commands keep routing to the old tab.
      const owningWorktreeId = worktreeId ?? this.browserManager.getWorktreeIdForTab(tabId)
      // Why: `tab switch --page` may omit --worktree, so still update the owning worktree's active slot for later scoped commands.
      if (owningWorktreeId) {
        this.activeWebContentsPerWorktree.set(owningWorktreeId, wcId)
      }
      this.options.onTabsChanged?.(owningWorktreeId ?? undefined)
      return { switched: switchedIndex, browserPageId: tabId }
    })
  }
  // ── Internal ──

  protected async enqueueCommand<T>(
    worktreeId: string | undefined,
    execute: (sessionName: string) => Promise<T>
  ): Promise<T> {
    return this.enqueueTargetedCommand(worktreeId, undefined, execute)
  }

  protected async enqueueTargetedCommand<T>(
    worktreeId: string | undefined,
    browserPageId: string | undefined,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions = {}
  ): Promise<T> {
    this.assertCommandAdmission()
    // Why: pick only the page here; its guest webContents can be re-registered while the command waits in the queue.
    const pageId = this.resolveCommandTarget(
      worktreeId,
      browserPageId,
      options.requireScopedTarget
    ).browserPageId
    const sessionName = `${ORCA_TAB_SESSION_PREFIX}${pageId}`

    return new Promise<T>((resolve, reject) => {
      let queue = this.commandQueues.get(sessionName)
      if (!queue) {
        queue = []
        this.commandQueues.set(sessionName, queue)
      }
      queue.push({
        execute: () => this.executeQueuedCommand(sessionName, worktreeId, pageId, execute, options),
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.processQueue(sessionName)
    })
  }

  protected async executeQueuedCommand<T>(
    sessionName: string,
    worktreeId: string | undefined,
    browserPageId: string,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions
  ): Promise<T> {
    this.assertCommandAdmission()
    // Why: inactive panes are display:none; the automation lease makes only this target paintable without selecting it.
    const restore = options.needsPaint
      ? await this.browserManager.acquireAutomationVisibility(
          this.resolveCommandTarget(worktreeId, browserPageId).webContentsId
        )
      : undefined
    try {
      // Why: resolve after the lease, since making a parked webview paintable can re-register the page.
      return await execute(
        sessionName,
        await this.resolveSessionTarget(sessionName, worktreeId, browserPageId, options)
      )
    } finally {
      restore?.()
    }
  }

  protected async resolveSessionTarget(
    sessionName: string,
    worktreeId: string | undefined,
    browserPageId: string,
    options: EnqueueTargetedCommandOptions
  ): Promise<ResolvedBrowserCommandTarget> {
    const target = this.resolveCommandTarget(worktreeId, browserPageId)
    if (options.ensureSession === false) {
      return target
    }
    const boundWebContentsId = this.sessions.get(sessionName)?.webContentsId
    if (boundWebContentsId === undefined || boundWebContentsId === target.webContentsId) {
      await this.ensureSession(sessionName, target.browserPageId, target.webContentsId)
      return target
    }

    if (this.activeWebContentsId === boundWebContentsId) {
      this.activeWebContentsId = target.webContentsId
    }
    if (worktreeId && this.activeWebContentsPerWorktree.get(worktreeId) === boundWebContentsId) {
      this.activeWebContentsPerWorktree.set(worktreeId, target.webContentsId)
    }

    // Why: the page was re-registered with a new guest webContents; the session still drives the old one.
    await this.restartSessionForTarget(sessionName, target.browserPageId, target.webContentsId)
    return target
  }

  protected async processQueue(sessionName: string): Promise<void> {
    if (this.processingQueues.has(sessionName)) {
      return
    }
    this.processingQueues.add(sessionName)

    const queue = this.commandQueues.get(sessionName)
    while (queue && queue.length > 0) {
      const cmd = queue.shift()!
      try {
        const result = await cmd.execute()
        cmd.resolve(result)
      } catch (error) {
        cmd.reject(error)
      }
    }

    if (queue && queue.length === 0 && this.commandQueues.get(sessionName) === queue) {
      this.commandQueues.delete(sessionName)
    }
    this.processingQueues.delete(sessionName)
  }
}
