import {
  AUTOMATION_VISIBILITY_ACQUIRE_TIMEOUT_MS,
  createNoopRestoreForTimedOutAutomationAcquire,
  isAutomationVisibilityToken,
  releaseAutomationVisibilityToken,
  resolveWithTimeout
} from './browser-manager-types'
import { BrowserManagerState } from './browser-manager-state'

export abstract class BrowserManagerVisibility extends BrowserManagerState {
  async acquireAutomationVisibility(guestWebContentsId: number): Promise<() => void> {
    const browserPageId = this.resolveBrowserTabIdForGuestWebContentsId(guestWebContentsId)
    if (!browserPageId) {
      return () => {}
    }
    const renderer = this.resolveRendererForBrowserTab(browserPageId)
    if (!renderer || renderer.isDestroyed()) {
      return () => {}
    }

    // Why: agent commands need a paintable webview for lazy-loading sites without stealing the user's visible tab.
    const acquirePromise = renderer
      .executeJavaScript(
        `(async function() {
            var bridge = window.__orcaBrowserAutomationVisibility;
            if (!bridge || typeof bridge.acquire !== 'function') return null;
            return await bridge.acquire(${JSON.stringify(browserPageId)});
          })()`
      )
      .catch(() => null)
    const { value: token, timedOut } = await resolveWithTimeout(
      acquirePromise,
      AUTOMATION_VISIBILITY_ACQUIRE_TIMEOUT_MS,
      null
    )

    if (!isAutomationVisibilityToken(token)) {
      return createNoopRestoreForTimedOutAutomationAcquire(renderer, acquirePromise, timedOut)
    }

    return () => {
      releaseAutomationVisibilityToken(renderer, token)
    }
  }
}
