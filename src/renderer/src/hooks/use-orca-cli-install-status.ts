import { useCallback, useEffect, useRef, useState } from 'react'
import type { CliInstallStatus } from '../../../shared/cli-install-types'
import { isOrcaCliAvailableOnPath } from '@/lib/agent-skill-cli-prerequisite'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { ORCHESTRATION_SETUP_STATE_EVENT } from '@/lib/orchestration-setup-state'
import type { ProjectAgentSkillRuntime } from '@/lib/project-skill-runtime'
import { getWslCliDistroRequest } from '@/components/settings/CliSkillRuntimeSetup'
import { useActiveSkillDiscoveryRuntimeTarget } from './use-active-skill-discovery-runtime-target'

export type OrcaCliSkillRuntime = {
  agentRuntime?: ProjectAgentSkillRuntime
  installDisabledReason: string | null
}

export type OrcaCliInstallStatusState = {
  status: CliInstallStatus | null
  checked: boolean
  loading: boolean
  registered: boolean
  /** This client cannot read the CLI on the host where agents run (paired web client or remote runtime). */
  unverifiable: boolean
  refresh: () => void
}

type ProbeTargetKind = 'install-disabled' | 'host' | 'wsl'

type ProbeState = {
  key: string | null
  status: CliInstallStatus | null
  checked: boolean
  loading: boolean
}

const INITIAL_PROBE_STATE: ProbeState = { key: null, status: null, checked: false, loading: false }

function getProbeTargetKind(runtime: OrcaCliSkillRuntime): ProbeTargetKind {
  if (runtime.installDisabledReason) {
    return 'install-disabled'
  }
  return runtime.agentRuntime?.runtime === 'wsl' ? 'wsl' : 'host'
}

async function readOrcaCliInstallStatus(
  kind: ProbeTargetKind,
  wslDistro: string | undefined
): Promise<CliInstallStatus | null> {
  // Why: a runtime that needs repair has no install target, so there is nothing to read.
  if (kind === 'install-disabled' || !window.api?.cli) {
    return null
  }
  return kind === 'wsl'
    ? window.api.cli.getWslInstallStatus(wslDistro ? { distro: wslDistro } : undefined)
    : window.api.cli.getInstallStatus()
}

/** Runtime-aware read of whether agents can run the `orca` command. */
export function useOrcaCliInstallStatus(
  activeSkillRuntime: OrcaCliSkillRuntime,
  { enabled = true }: { enabled?: boolean } = {}
): OrcaCliInstallStatusState {
  const runtimeTarget = useActiveSkillDiscoveryRuntimeTarget()
  // Why: the local CLI says nothing about a host this window only reaches over RPC.
  const unverifiable =
    isPairedWebClientWindow() || (runtimeTarget !== null && runtimeTarget.kind !== 'local')
  const probeEnabled = enabled && runtimeTarget !== null && !unverifiable
  const targetKind = getProbeTargetKind(activeSkillRuntime)
  const wslDistro =
    targetKind === 'wsl'
      ? getWslCliDistroRequest(activeSkillRuntime.agentRuntime)?.distro
      : undefined
  const probeKey = `${targetKind}:${wslDistro ?? ''}`
  const [probe, setProbe] = useState<ProbeState>(INITIAL_PROBE_STATE)
  const sequenceRef = useRef(0)

  const refresh = useCallback((): void => {
    if (!probeEnabled) {
      return
    }
    const refreshId = ++sequenceRef.current
    const finish = (status: CliInstallStatus | null): void => {
      if (refreshId === sequenceRef.current) {
        setProbe({ key: probeKey, status, checked: true, loading: false })
      }
    }
    setProbe((current) => {
      if (current.key !== probeKey) {
        return { key: probeKey, status: null, checked: false, loading: true }
      }
      return current.loading ? current : { ...current, loading: true }
    })
    readOrcaCliInstallStatus(targetKind, wslDistro).then(finish, () => finish(null))
  }, [probeEnabled, probeKey, targetKind, wslDistro])

  useEffect(() => {
    if (!probeEnabled) {
      return
    }
    refresh()
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    // Why: users register the CLI from Settings or a shell, so re-read on return.
    window.addEventListener('focus', refresh)
    window.addEventListener(ORCHESTRATION_SETUP_STATE_EVENT, refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      // Why: bump the sequence so a response for a retired runtime cannot land.
      sequenceRef.current += 1
      window.removeEventListener('focus', refresh)
      window.removeEventListener(ORCHESTRATION_SETUP_STATE_EVENT, refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [probeEnabled, refresh])

  const current = probeEnabled && probe.key === probeKey ? probe : INITIAL_PROBE_STATE
  return {
    status: current.status,
    checked: unverifiable || current.checked,
    loading: probeEnabled && (!current.checked || current.loading),
    registered: isOrcaCliAvailableOnPath(current.status),
    unverifiable,
    refresh
  }
}
