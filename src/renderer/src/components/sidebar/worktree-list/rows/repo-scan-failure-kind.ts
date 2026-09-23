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
const LOCAL_TOOLCHAIN_FAILURE_KINDS = ['xcode-license', 'developer-tools'] as const

export type LocalToolchainFailureKind = (typeof LOCAL_TOOLCHAIN_FAILURE_KINDS)[number]

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

export function localToolchainFailureKind(
  failure: RepoScanFailure | null
): LocalToolchainFailureKind | null {
  if (!failure?.isLocalMac) {
    return null
  }
  return LOCAL_TOOLCHAIN_FAILURE_KINDS.find((kind) => kind === failure.kind) ?? null
}

export function findLocalToolchainBlock(
  repos: readonly Repo[],
  detectedByRepo: Record<string, DetectedWorktreeListResult | undefined>
): { kind: LocalToolchainFailureKind; repos: Repo[] } | null {
  const blocked = repos.flatMap((repo) => {
    const kind = localToolchainFailureKind(resolveRepoScanFailure(repo, detectedByRepo[repo.id]))
    return kind ? [{ repo, kind }] : []
  })
  return blocked.length > 0
    ? { kind: blocked[0].kind, repos: blocked.map(({ repo }) => repo) }
    : null
}
