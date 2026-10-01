import type { LegacyOverlayAgentKind, PiAgentKind } from '../shared/pi-agent-kind'

// Why per-kind names: the relay mirrors each pi-family agent's overlay state under
// its own directory so two installed agents never shadow each other's state.
export const PI_OVERLAY_SUBDIR_BY_KIND: Record<LegacyOverlayAgentKind, string> = {
  pi: 'pi-overlays',
  omp: 'omp-overlays',
  omo: 'omo-overlays'
}

export const PI_AGENT_HOME_DIR_NAME: Record<PiAgentKind, string> = {
  pi: '.pi',
  omp: '.omp',
  omo: '.omo',
  'prime-agent': '.prime'
}
