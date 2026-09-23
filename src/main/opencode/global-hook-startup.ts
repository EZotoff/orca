// Why: Task 16 — startup-facing wrapper for the guarded global-hook installer. Runs lazily
// from the first-window startup path (never at module init), gated OFF by default: live
// install is Task 17/18 territory behind the operator's authorization flow, so this only
// activates when ORCA_ENABLE_GLOBAL_HOOK_INSTALL=1 is explicitly set. Also performs the
// design-§6 startup digest self-check (log-only warning on mismatch — the live-config guard
// does not cover ~/.config/opencode/plugins/, per spikes/g3-guard-probe.md).

import { join } from 'node:path'
import {
  installGlobalOpenCodeHook,
  verifyGlobalOpenCodeHook,
  type GlobalHookVerifyStatus
} from './global-hook-installer'

const ENABLE_ENV = 'ORCA_ENABLE_GLOBAL_HOOK_INSTALL'
const STATE_DIR_NAME = 'opencode-global-hook'

export function isGlobalHookInstallEnabled(): boolean {
  return process.env[ENABLE_ENV] === '1'
}

export function globalHookPathsFor(homeDir: string, userDataDir: string) {
  return {
    pluginsDir: join(homeDir, '.config', 'opencode', 'plugins'),
    stateDir: join(userDataDir, STATE_DIR_NAME)
  }
}

export async function maybeInstallGlobalOpenCodeHook(args: {
  readonly homeDir: string
  readonly userDataDir: string
  readonly enabled: boolean
}): Promise<void> {
  if (!args.enabled) {
    return
  }
  const paths = globalHookPathsFor(args.homeDir, args.userDataDir)
  try {
    const outcome = await installGlobalOpenCodeHook({ paths })
    console.log(`[opencode-global-hook] install outcome: ${outcome.status}`, outcome)
  } catch (error) {
    // Why: never block or fail startup on the hook; log and continue.
    console.warn('[opencode-global-hook] install failed:', error)
  }
  await logGlobalHookDigestCheck(paths.pluginsDir)
}

export async function logGlobalHookDigestCheck(pluginsDir: string): Promise<void> {
  let status: GlobalHookVerifyStatus
  try {
    status = await verifyGlobalOpenCodeHook({ pluginsDir })
  } catch (error) {
    console.warn('[opencode-global-hook] digest self-check errored:', error)
    return
  }
  if (status === 'ok') {
    return
  }
  // v1: log-only (design §6). Any non-ok state is surfaced, never auto-repaired here.
  console.warn(`[opencode-global-hook] installed plugin self-check: ${status}`)
}
