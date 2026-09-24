// Why: Task 16 (orca-transition design §6) — atomic guarded installer for the globally
// auto-discovered OpenCode status plugin at ~/.config/opencode/plugins/orca-opencode-status.js.
// Installs WITHOUT OPENCODE_CONFIG_DIR and without touching the symlinked opencode.json:
// the plugin is fail-closed (see global-hook-plugin-source.ts) and only activates in
// processes Orca provisioned with ORCA_HOOK_STATE_DIR.
//
// Guarantees (all under one cross-process advisory lock):
//   - refuse to clobber a foreign file (no valid Orca marker), a symlink, or a directory;
//   - refuse a marker whose recorded digest disagrees with the file's own body (tamper);
//   - no-op when the installed digest already matches the current build;
//   - backup+replace when an owned older version is present (.bak-<ts> sidecar, 0600,
//     outside OpenCode's *.{ts,js} discovery glob);
//   - install is temp-write + fsync + atomic rename; the temp name never matches the
//     discovery glob, so an interrupted install never exposes a torn plugin.
//   - the ONLY filesystem writes are inside the plugins dir and Orca's own state dir (G3).

import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileTransactionLock } from '../file-transaction-lock'
import {
  durableWriteTempPath,
  renameDurable,
  writeTempFileDurable
} from '../durable-file-write'
import {
  buildMarkedGlobalHookContent,
  hashGlobalHookBody,
  installedGlobalHookBodyDigest,
  parseMarkedGlobalHookContent
} from './global-hook-marker'
import { getGlobalHookPluginBody } from './global-hook-plugin-source'

export const GLOBAL_HOOK_PLUGIN_FILE = 'orca-opencode-status.js'
export const GLOBAL_HOOK_INSTALLER_VERSION = 1
const OUTCOME_RECORD_FILE = 'last-install-outcome.json'

export type GlobalHookPaths = {
  /** Directory OpenCode scans for auto-discovered plugins (…/.config/opencode/plugins). */
  readonly pluginsDir: string
  /** Orca-owned state dir for install/refusal records; never inside the discovery glob. */
  readonly stateDir: string
}

export type GlobalHookRefusalReason =
  | 'foreign-file'
  | 'symlink'
  | 'directory'
  | 'tampered-marker'

export type GlobalHookInstallOutcome =
  | { readonly status: 'installed' }
  | { readonly status: 'noop' }
  | { readonly status: 'replaced'; readonly backupPath: string }
  | { readonly status: 'refused'; readonly reason: GlobalHookRefusalReason }

export type GlobalHookUninstallOutcome =
  | { readonly status: 'removed' }
  | { readonly status: 'restored'; readonly backupPath: string }
  | { readonly status: 'absent' }
  | { readonly status: 'refused'; readonly reason: GlobalHookRefusalReason }

export type GlobalHookVerifyStatus =
  | 'ok'
  | 'missing'
  | 'foreign'
  | 'tampered'
  | 'outdated'

export type GlobalHookInstallerOptions = {
  readonly paths: GlobalHookPaths
  /** Injectable clock; defaults to real time. */
  readonly now?: () => Date
  /**
   * Test-only crash injection: called after the temp file is durable but BEFORE the
   * atomic rename — the exact torn-install window. Whatever it throws propagates.
   */
  readonly crashBetweenTempAndRename?: () => void
}

function backupSuffix(now: Date): string {
  return `.bak-${now.toISOString().replace(/[:.]/g, '-')}`
}

async function readTarget(pluginPath: string): Promise<{ kind: 'absent' } | { kind: 'symlink' } | { kind: 'directory' } | { kind: 'file'; content: string }> {
  let stats
  try {
    stats = await lstat(pluginPath)
  } catch {
    return { kind: 'absent' }
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'symlink' }
  }
  if (stats.isDirectory()) {
    return { kind: 'directory' }
  }
  return { kind: 'file', content: await readFile(pluginPath, 'utf8') }
}

export async function writeOutcomeRecord(
  stateDir: string,
  outcome: GlobalHookInstallOutcome | GlobalHookUninstallOutcome | { readonly status: string; readonly reason: string },
  now: Date
): Promise<void> {
  // Why: the install outcome is already decided by the time we record it; a record-write
  // failure (missing dir, read-only state) must never turn a successful install into a throw.
  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 })
    const record = `${JSON.stringify({ at: now.toISOString(), outcome }, null, 2)}\n`
    const tmpPath = durableWriteTempPath(join(stateDir, OUTCOME_RECORD_FILE))
    await writeTempFileDurable(tmpPath, record)
    await renameDurable(tmpPath, join(stateDir, OUTCOME_RECORD_FILE))
  } catch {
    // Best-effort audit record; the returned outcome is the authority.
  }
}

async function publishPlugin(
  pluginPath: string,
  content: string,
  crashHook: (() => void) | undefined
): Promise<void> {
  const tmpPath = durableWriteTempPath(pluginPath)
  let renamed = false
  try {
    await writeTempFileDurable(tmpPath, content)
    crashHook?.()
    await renameDurable(tmpPath, pluginPath)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tmpPath, { force: true }).catch(() => {})
    }
  }
}

async function backupExisting(
  pluginPath: string,
  content: string,
  now: Date
): Promise<string> {
  const backupPath = `${pluginPath}${backupSuffix(now)}`
  const tmpPath = durableWriteTempPath(backupPath)
  // Why 0600: backups live beside the plugin but must not be world-readable state.
  await writeTempFileDurable(tmpPath, content, 0o600)
  await renameDurable(tmpPath, backupPath)
  return backupPath
}

export async function installGlobalOpenCodeHook(
  options: GlobalHookInstallerOptions
): Promise<GlobalHookInstallOutcome> {
  const pluginPath = join(options.paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  return withFileTransactionLock(pluginPath, () => installGlobalOpenCodeHookUnlocked(options))
}

/** Lock-free core — the caller MUST already hold the installer lock on the plugin path. */
export async function installGlobalOpenCodeHookUnlocked(
  options: GlobalHookInstallerOptions
): Promise<GlobalHookInstallOutcome> {
  const now = options.now ?? (() => new Date())
  const pluginPath = join(options.paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  const body = getGlobalHookPluginBody()
  const expectedDigest = hashGlobalHookBody(body)
  {
    const target = await readTarget(pluginPath)
    let outcome: GlobalHookInstallOutcome
    if (target.kind === 'symlink') {
      outcome = { status: 'refused', reason: 'symlink' }
    } else if (target.kind === 'directory') {
      outcome = { status: 'refused', reason: 'directory' }
    } else if (target.kind === 'file') {
      const parsed = parseMarkedGlobalHookContent(target.content)
      if (!parsed) {
        outcome = { status: 'refused', reason: 'foreign-file' }
      } else if (installedGlobalHookBodyDigest(target.content) !== parsed.marker.digest) {
        // Recorded digest disagrees with the bytes actually installed — tampered or torn.
        outcome = { status: 'refused', reason: 'tampered-marker' }
      } else if (parsed.marker.digest === expectedDigest) {
        outcome = { status: 'noop' }
      } else {
        const backupPath = await backupExisting(pluginPath, target.content, now())
        await publishPlugin(
          pluginPath,
          buildMarkedGlobalHookContent(body, {
            installerVersion: GLOBAL_HOOK_INSTALLER_VERSION,
            installedAt: now().toISOString(),
            digest: expectedDigest
          }),
          options.crashBetweenTempAndRename
        )
        outcome = { status: 'replaced', backupPath }
      }
    } else {
      await publishPlugin(
        pluginPath,
        buildMarkedGlobalHookContent(body, {
          installerVersion: GLOBAL_HOOK_INSTALLER_VERSION,
          installedAt: now().toISOString(),
          digest: expectedDigest
        }),
        options.crashBetweenTempAndRename
      )
      outcome = { status: 'installed' }
    }
    await writeOutcomeRecord(options.paths.stateDir, outcome, now())
    return outcome
  }
}

// Why: derive the plugin's directory from its path so backup listing stays local.
function pluginPathDir(pluginPath: string): string {
  return dirname(pluginPath)
}


export async function uninstallGlobalOpenCodeHook(
  options: GlobalHookInstallerOptions
): Promise<GlobalHookUninstallOutcome> {
  const pluginPath = join(options.paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  return withFileTransactionLock(pluginPath, () => uninstallGlobalOpenCodeHookUnlocked(options))
}

/** Lock-free core — the caller MUST already hold the installer lock on the plugin path. */
export async function uninstallGlobalOpenCodeHookUnlocked(
  options: GlobalHookInstallerOptions
): Promise<GlobalHookUninstallOutcome> {
  const now = options.now ?? (() => new Date())
  const pluginPath = join(options.paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  {
    const target = await readTarget(pluginPath)
    if (target.kind === 'absent') {
      return { status: 'absent' } satisfies GlobalHookUninstallOutcome
    }
    if (target.kind === 'symlink' || target.kind === 'directory') {
      const outcome = {
        status: 'refused',
        reason: target.kind === 'symlink' ? 'symlink' : 'directory'
      } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    }
    const parsed = parseMarkedGlobalHookContent(target.content)
    if (!parsed) {
      const outcome = { status: 'refused', reason: 'foreign-file' } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    }
    if (installedGlobalHookBodyDigest(target.content) !== parsed.marker.digest) {
      const outcome = { status: 'refused', reason: 'tampered-marker' } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    }
    // Owned: restore the newest backup if one exists, else remove outright.
    const backup = await newestBackupInner(pluginPath)
    if (backup) {
      const backupContent = await readFile(backup, 'utf8')
      await publishPlugin(pluginPath, backupContent, options.crashBetweenTempAndRename)
      await rm(backup, { force: true })
      const outcome = { status: 'restored', backupPath: backup } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    }
    await rm(pluginPath, { force: true })
    const outcome = { status: 'removed' } as const
    await writeOutcomeRecord(options.paths.stateDir, outcome, now())
    return outcome
  }
}

async function newestBackupInner(pluginPath: string): Promise<string | null> {
  const dir = pluginPathDir(pluginPath)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const backups = names
    .filter((name) => name.startsWith(`${GLOBAL_HOOK_PLUGIN_FILE}.bak-`))
    .sort()
  const newest = backups.at(-1)
  return newest ? join(dir, newest) : null
}

export async function verifyGlobalOpenCodeHook(
  paths: Pick<GlobalHookPaths, 'pluginsDir'>
): Promise<GlobalHookVerifyStatus> {
  const pluginPath = join(paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  const target = await readTarget(pluginPath)
  if (target.kind === 'absent') {
    return 'missing'
  }
  if (target.kind !== 'file') {
    return 'foreign'
  }
  const parsed = parseMarkedGlobalHookContent(target.content)
  if (!parsed) {
    return 'foreign'
  }
  if (installedGlobalHookBodyDigest(target.content) !== parsed.marker.digest) {
    return 'tampered'
  }
  return parsed.marker.digest === hashGlobalHookBody(getGlobalHookPluginBody())
    ? 'ok'
    : 'outdated'
}
