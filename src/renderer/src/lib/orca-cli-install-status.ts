import type { CliInstallStatus } from '../../../shared/cli-install-types'
import type { ProjectAgentSkillRuntime } from './project-skill-runtime'
import { getWslCliDistroRequest } from '@/components/settings/CliSkillRuntimeSetup'

export type OrcaCliSkillRuntime = {
  agentRuntime?: ProjectAgentSkillRuntime
  installDisabledReason: string | null
}

export const ORCA_CLI_INSTALL_STATE_EVENT = 'orca:cli-install-state'

/** Tell every mounted CLI status reader to re-read after a registration attempt. */
export function notifyOrcaCliInstallStateChanged(): void {
  window.dispatchEvent(new CustomEvent(ORCA_CLI_INSTALL_STATE_EVENT))
}

/** Reads `orca` where this runtime's agents run it: the WSL distro for a WSL runtime, else the host. */
export function readAgentRuntimeCliInstallStatus(
  agentRuntime?: ProjectAgentSkillRuntime
): Promise<CliInstallStatus> {
  return agentRuntime?.runtime === 'wsl'
    ? window.api.cli.getWslInstallStatus(getWslCliDistroRequest(agentRuntime))
    : window.api.cli.getInstallStatus()
}

/** Identifies what `readOrcaCliInstallStatus` reads, so callers can drop results for a retired target. */
export function getOrcaCliInstallTargetKey(runtime: OrcaCliSkillRuntime): string {
  if (runtime.installDisabledReason) {
    return 'install-disabled'
  }
  if (runtime.agentRuntime?.runtime !== 'wsl') {
    return 'host'
  }
  return `wsl:${getWslCliDistroRequest(runtime.agentRuntime)?.distro ?? ''}`
}

/** Runtime-aware read; null when the runtime needs repair and so has no install target. */
export async function readOrcaCliInstallStatus(
  runtime: OrcaCliSkillRuntime
): Promise<CliInstallStatus | null> {
  if (runtime.installDisabledReason || !window.api?.cli) {
    return null
  }
  return readAgentRuntimeCliInstallStatus(runtime.agentRuntime)
}
