import type { Repo } from '../../../../../../shared/repo-types'
import type { DetectedWorktreeListResult } from '../../../../../../shared/worktree/types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import {
  classifyWorktreeScanFailure,
  type WorktreeScanFailureKind
} from '../../../../../../shared/worktree-scan-failure'

export type RepoScanFailure = {
  kind: WorktreeScanFailureKind
  reason: string
  executionHostId: ExecutionHostId
  isLocalMac: boolean
}

// Why: these break Git for every local repo at once, so the sidebar banner owns them, not per-repo marks.
const MACHINE_WIDE_LOCAL_MAC_FAILURE_KINDS: ReadonlySet<WorktreeScanFailureKind> = new Set([
  'xcode-license',
  'developer-tools'
])

export function resolveRepoScanFailure(
  repo: Repo,
  detected: DetectedWorktreeListResult | undefined
): RepoScanFailure | null {
  if (!detected || detected.authoritative || !detected.unavailableReason) {
    return null
  }
  const executionHostId = getRepoExecutionHostId(repo)
  const isLocalMac =
    executionHostId === 'local' && !repo.connectionId && navigator.userAgent.includes('Mac')
  const kind =
    detected.failureKind ??
    (isLocalMac ? classifyWorktreeScanFailure(detected.unavailableReason) : 'unknown')
  return { kind, reason: detected.unavailableReason, executionHostId, isLocalMac }
}

export function isMachineWideLocalScanFailure(failure: RepoScanFailure): boolean {
  return failure.isLocalMac && MACHINE_WIDE_LOCAL_MAC_FAILURE_KINDS.has(failure.kind)
}
