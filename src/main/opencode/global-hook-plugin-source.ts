// Why: Task 16 (orca-transition) — the globally auto-discovered OpenCode status plugin.
// Unlike the per-PTY plugin in hook-service.ts (installed under OPENCODE_CONFIG_DIR and
// POSTing to the agent-hooks server), this file lands in ~/.config/opencode/plugins/ where
// OpenCode auto-discovers it for EVERY process, so it must be fail-closed: unless Orca
// provisioned this process with ORCA_HOOK_STATE_DIR, no handlers are registered, nothing
// is written, and no network is touched. Identity is reported via atomic file drops only.
// The body here is the stable content the installer hashes into its ownership marker.
//
// Task 17 (design §6 "Process isolation"): the factory validates BOTH the state dir AND
// a single-purpose identity token (ORCA_HOOK_IDENTITY_TOKEN, created/revoked via
// global-hook-env.ts) BEFORE registering any handler, and probes state-dir writability.
// Any ambiguity (missing/malformed/revoked token, unwritable state dir) → return {} —
// never a partial activation. Guard refusals are logged (reason only, never the token)
// to <stateDir>/guard-refusals.log for Orca-side diagnostics.

export const GLOBAL_HOOK_STATE_DIR_ENV = 'ORCA_HOOK_STATE_DIR'
export const GLOBAL_HOOK_IDENTITY_TOKEN_ENV = 'ORCA_HOOK_IDENTITY_TOKEN'

export function getGlobalHookPluginBody(): string {
  return `import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const STATE_DIR_ENV = ${JSON.stringify(GLOBAL_HOOK_STATE_DIR_ENV)}
const IDENTITY_TOKEN_ENV = ${JSON.stringify(GLOBAL_HOOK_IDENTITY_TOKEN_ENV)}
const REVOKED_TOKENS_FILE = 'revoked-tokens.json'
const GUARD_REFUSALS_LOG = 'guard-refusals.log'

// Fail-closed identity gate (design §6): validate the Orca-provided env BEFORE
// registering any event handlers or touching the filesystem beyond the guard
// probe itself. A plain OpenCode process (not launched by Orca) never sees
// these variables and gets an inert hook.
function isProvisionedStateDir(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.includes('..') &&
    value.length <= 4096
  )
}

function isProvisionedIdentityToken(value) {
  if (typeof value !== 'string') {
    return false
  }
  if (!value.startsWith('orca1.')) {
    return false
  }
  const random = value.slice('orca1.'.length)
  return (
    random.length >= 32 &&
    random.length <= 512 &&
    /^[A-Za-z0-9_-]+$/.test(random)
  )
}

function toDropFileName(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe + '.json'
}

// Log-only diagnostics (reason + pid, NEVER the token value); best-effort.
function logGuardRefusal(stateDir, reason) {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.appendFileSync(
      path.join(stateDir, GUARD_REFUSALS_LOG),
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, reason }) + '\\n'
    )
  } catch {
    // The state dir is unusable — nothing more we can (or should) do.
  }
}

// Fail-closed revocation read: a missing list means nothing is revoked; a
// present-but-unparseable list is ambiguity and deactivates the plugin.
function readRevokedDigests(stateDir) {
  let raw
  try {
    raw = fs.readFileSync(path.join(stateDir, REVOKED_TOKENS_FILE), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed.filter((digest) => typeof digest === 'string')
  } catch {
    return null
  }
}

export default async function OrcaOpenCodeStatusPlugin(input) {
  const stateDir = process.env[STATE_DIR_ENV]
  const identityToken = process.env[IDENTITY_TOKEN_ENV]
  if (!isProvisionedStateDir(stateDir)) {
    return {}
  }
  if (!isProvisionedIdentityToken(identityToken)) {
    logGuardRefusal(stateDir, 'malformed-identity-token')
    return {}
  }
  const identityDigest = createHash('sha256').update(identityToken).digest('hex')
  const revokedDigests = readRevokedDigests(stateDir)
  if (revokedDigests === null) {
    logGuardRefusal(stateDir, 'revocation-list-invalid')
    return {}
  }
  if (revokedDigests.includes(identityDigest)) {
    logGuardRefusal(stateDir, 'revoked-identity-token')
    return {}
  }
  const dropDir = path.join(stateDir, 'opencode-sessions')
  try {
    // Writability probe before registration: an unusable state dir deactivates
    // the plugin entirely rather than degrading to partial activation.
    fs.mkdirSync(dropDir, { recursive: true })
    fs.accessSync(dropDir, fs.constants.W_OK)
  } catch {
    logGuardRefusal(stateDir, 'state-dir-unwritable')
    return {}
  }
  const identityHash = identityDigest.slice(0, 16)
  const writeDrop = (info) => {
    try {
      const record = {
        schemaVersion: 1,
        sessionID: info.id,
        projectID: info.projectID,
        directory: info.directory,
        worktree: input.worktree,
        parentID: typeof info.parentID === 'string' ? info.parentID : undefined,
        title: typeof info.title === 'string' ? info.title.slice(0, 200) : undefined,
        agentPid: process.pid,
        identityHash,
        reportedAt: Date.now()
      }
      const finalPath = path.join(dropDir, toDropFileName(String(info.id)))
      const tmpPath = finalPath + '.' + process.pid + '.tmp'
      fs.writeFileSync(tmpPath, JSON.stringify(record) + '\\n')
      fs.renameSync(tmpPath, finalPath)
    } catch {
      // Fail-open for OpenCode: identity reporting is best-effort telemetry.
    }
  }
  return {
    event: async ({ event }) => {
      try {
        if (event.type === 'session.created' || event.type === 'session.updated') {
          const info = event.properties && event.properties.info
          if (info && typeof info.id === 'string' && info.id.length > 0) {
            writeDrop(info)
          }
        }
      } catch {
        // Never fail OpenCode eventing on the hook.
      }
    }
  }
}
`
}
