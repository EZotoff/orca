import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  isWslShellName,
  resolveLocalWindowsTerminalRuntimeOptions
} from '../../../../shared/local-windows-terminal-runtime'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/project-execution-runtime'
import { parsePtySessionId } from '../../../../shared/pty-session-id-format'
import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree/id'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import { resolveLocalProjectRuntimeForWorktreeId } from '../../../local-project-runtime-resolution'
import type { Store } from '../../../persistence'
import { connectInFlight } from '../../ssh-connect-attempt-registry'

export type PaneProviderReadinessDeps = {
  getLocalPtyStartupPromise: (connectionId?: string | null) => Promise<void> | undefined
  getManagedWslCliStartupBarrier?: () => Promise<void> | undefined
  getSettings?: () => GlobalSettings | undefined
  store?: Store
}

export type PaneProviderTarget = {
  connectionId?: string | null
  worktreeId?: string
  cwd?: string
  sessionId?: string
  shellOverride?: string
  projectRuntime?: ProjectExecutionRuntimeResolution
}

function isWslWorkspaceId(worktreeId: string | null | undefined): boolean {
  const worktreePath = worktreeId ? splitWorktreeIdForFilesystem(worktreeId)?.worktreePath : null
  return Boolean(worktreePath && isWslUncPath(worktreePath))
}

function isLocalWslPane(deps: PaneProviderReadinessDeps, target: PaneProviderTarget): boolean {
  if (process.platform !== 'win32') {
    return false
  }
  if (
    (target.cwd && isWslUncPath(target.cwd)) ||
    isWslWorkspaceId(target.worktreeId) ||
    (target.sessionId && isWslWorkspaceId(parsePtySessionId(target.sessionId).worktreeId))
  ) {
    return true
  }
  try {
    const { shellOverride } = resolveLocalWindowsTerminalRuntimeOptions({
      requestedShellOverride: target.shellOverride,
      settings: deps.getSettings?.(),
      projectRuntime:
        target.projectRuntime ??
        resolveLocalProjectRuntimeForWorktreeId(deps.store, target.worktreeId)
    })
    return isWslShellName(shellOverride)
  } catch {
    // Why: a project runtime needing repair fails the spawn preflight with its own message.
    return false
  }
}

/**
 * Waits for the provider that owns this pane's kind before its owner is resolved or spawned.
 * Undefined means nothing is pending, so synchronous callers stay synchronous.
 */
export function awaitPaneProviderReady(
  deps: PaneProviderReadinessDeps,
  target: PaneProviderTarget
): Promise<void> | undefined {
  if (target.connectionId) {
    // Why: join a connect already under way but never dial one. Passphrase and runtime-owned
    // targets stay user-driven, and a target with no provider answers unverifiable downstream.
    return connectInFlight.get(target.connectionId)?.promise.then(
      () => undefined,
      () => undefined
    )
  }
  const localStartup = deps.getLocalPtyStartupPromise(null)
  // Why: a WSL shell must not start against a managed WSL `orca` registration still reconciling.
  const wslBarrier = isLocalWslPane(deps, target)
    ? deps.getManagedWslCliStartupBarrier?.()
    : undefined
  if (!localStartup && !wslBarrier) {
    return undefined
  }
  return Promise.all([localStartup, wslBarrier]).then(() => undefined)
}
