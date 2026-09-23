// Why: Task 16 (orca-transition) — the globally auto-discovered OpenCode status plugin.
// Unlike the per-PTY plugin in hook-service.ts (installed under OPENCODE_CONFIG_DIR and
// POSTing to the agent-hooks server), this file lands in ~/.config/opencode/plugins/ where
// OpenCode auto-discovers it for EVERY process, so it must be fail-closed: unless Orca
// provisioned this process with ORCA_HOOK_STATE_DIR, no handlers are registered, nothing
// is written, and no network is touched. Identity is reported via atomic file drops only.
// The body here is the stable content the installer hashes into its ownership marker.

export const GLOBAL_HOOK_STATE_DIR_ENV = 'ORCA_HOOK_STATE_DIR'

export function getGlobalHookPluginBody(): string {
  return `import fs from 'node:fs'
import path from 'node:path'

// Fail-closed identity gate (design §6): validate the Orca-provided env BEFORE
// registering any event handlers or touching the filesystem. A plain OpenCode
// process (not launched by Orca) never sees this variable and gets an inert hook.
function isProvisionedStateDir(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.includes('..') &&
    value.length <= 4096
  )
}

function toDropFileName(sessionId) {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe + '.json'
}

export default async function OrcaOpenCodeStatusPlugin(input) {
  const stateDir = process.env.${GLOBAL_HOOK_STATE_DIR_ENV}
  if (!isProvisionedStateDir(stateDir)) {
    return {}
  }
  const dropDir = path.join(stateDir, 'opencode-sessions')
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
        reportedAt: Date.now()
      }
      fs.mkdirSync(dropDir, { recursive: true })
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
