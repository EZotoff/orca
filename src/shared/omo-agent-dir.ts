import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * omo (OMO Native / senpi, npm omo-ai) agent-dir resolution.
 *
 * omo's own `canonicalAgentDir()` ranks OMO_CODING_AGENT_DIR → SENPI_CODING_AGENT_DIR →
 * PI_CODING_AGENT_DIR → ~/.omo/agent. Orca deliberately never injects PI_CODING_AGENT_DIR
 * (probe 96), so the fork-owned ORCA_OMO_AGENT_DIR sits at the top of Orca's own chain as
 * the explicit way to point Orca (extensions + session scan) at a specific agent dir —
 * e.g. the pilot sandbox at ~/AI_projects/omo-v5-pilot/agent — without touching the child
 * omo process's env.
 */
export const ORCA_OMO_AGENT_DIR_ENV = 'ORCA_OMO_AGENT_DIR'

export function defaultOmoAgentDir(): string {
  return join(homedir(), '.omo', 'agent')
}

/** Orca-side resolution: ORCA_OMO_AGENT_DIR → OMO_CODING_AGENT_DIR → SENPI_CODING_AGENT_DIR → ~/.omo/agent. */
export function resolveOmoAgentDir(read: (key: string) => string | undefined): string {
  const override =
    read('ORCA_OMO_AGENT_DIR') ?? read('OMO_CODING_AGENT_DIR') ?? read('SENPI_CODING_AGENT_DIR')
  return override || defaultOmoAgentDir()
}

/** Variant that leaves the override unset when no env names a dir (no implicit default). */
export function resolveOmoAgentDirOverride(
  read: (key: string) => string | undefined
): string | undefined {
  return (
    read('ORCA_OMO_AGENT_DIR') ?? read('OMO_CODING_AGENT_DIR') ?? read('SENPI_CODING_AGENT_DIR')
  )
}
