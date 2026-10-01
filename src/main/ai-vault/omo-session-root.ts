import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { safeRoot } from './omp-session-root'
import { normalizeAgentSessionsDir } from './session-scanner-values'

/** Mirrors omo's own agent-dir precedence (omo-ai agent-dir.js):
 * OMO_CODING_AGENT_DIR → SENPI_CODING_AGENT_DIR → PI_CODING_AGENT_DIR → ~/.omo/agent.
 * An explicit sessions root never falls back. */
export function resolveOmoSessionsDir(
  options: {
    sessionsDir?: string
    env?: NodeJS.ProcessEnv
    homeDir?: string
  } = {}
): string {
  if (options.sessionsDir !== undefined) {
    return safeRoot(options.sessionsDir)
  }
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()
  for (const key of [
    'OMO_CODING_AGENT_DIR',
    'SENPI_CODING_AGENT_DIR',
    'PI_CODING_AGENT_DIR'
  ] as const) {
    const value = env[key]?.trim()
    if (value) {
      return safeRoot(normalizeAgentSessionsDir(normalize(value), '.omo'))
    }
  }
  return safeRoot(join(home, '.omo', 'agent', 'sessions'))
}
