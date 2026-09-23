// A listing's catalog version is the generation its scan began at, so a create must bump that
// generation before anything after `git worktree add` can yield. Otherwise a listing that began
// before the add (no new row) and one that began after it (new row) share a sequence, and the
// client cannot refuse the older one: it purges the new workspace.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isWorktreeCatalogVersion } from '../../shared/worktree/catalog-version'
import { getLocalWorktreeScanGeneration } from '../local-worktree-scan-generation'
import {
  addWorktreeMock,
  getActiveMultiplexerMock,
  getSshGitProviderMock,
  listWorktreesMock
} from './worktrees-test-module-mocks'
import { handlers, setupWorktreeHandlers, store } from './worktrees-test-harness'

vi.mock('electron', async () =>
  (await import('./worktrees-test-module-mocks')).electronModuleMock()
)
vi.mock('../git/worktree', async () =>
  (await import('./worktrees-test-module-mocks')).gitWorktreeModuleMock()
)
vi.mock('../git/runner', async () =>
  (await import('./worktrees-test-module-mocks')).gitRunnerModuleMock()
)
vi.mock('../git/repo', async () =>
  (await import('./worktrees-test-module-mocks')).gitRepoModuleMock()
)
vi.mock('../git/git-username', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalGitUsername: (await import('./worktrees-test-module-mocks'))
    .resolveLocalGitUsernameMock
}))
vi.mock('../github/client', async () =>
  (await import('./worktrees-test-module-mocks')).githubClientModuleMock()
)
vi.mock('../source-control/hosted-review', async () =>
  (await import('./worktrees-test-module-mocks')).hostedReviewModuleMock()
)
vi.mock('../providers/ssh-git-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshGitDispatchModuleMock()
)
vi.mock('../providers/ssh-filesystem-dispatch', async () =>
  (await import('./worktrees-test-module-mocks')).sshFilesystemDispatchModuleMock()
)
vi.mock('./worktree-symlinks', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeSymlinksModuleMock()
)
vi.mock('./ssh', async () => (await import('./worktrees-test-module-mocks')).sshModuleMock())
vi.mock('../ssh/ssh-target-registry', async () =>
  (await import('./worktrees-test-module-mocks')).sshTargetRegistryModuleMock()
)
vi.mock('../hooks', async () => (await import('./worktrees-test-module-mocks')).hooksModuleMock())
vi.mock('../setup-runner-script-text', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupRunnerScriptTextModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../worktree-runner-script', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeRunnerScriptModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../effective-hook-config', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).effectiveHookConfigModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../setup-hook-env-vars', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).setupHookEnvVarsModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('./worktree-logic', async (importOriginal) =>
  (await import('./worktrees-test-module-mocks')).worktreeLogicModuleMock(
    (await importOriginal()) as Record<string, unknown>
  )
)
vi.mock('../terminal-history-deletion', async () =>
  (await import('./worktrees-test-module-mocks')).terminalHistoryDeletionModuleMock()
)
vi.mock('../ports/advertised-url-watcher', async () =>
  (await import('./worktrees-test-module-mocks')).advertisedUrlWatcherModuleMock()
)
vi.mock('../workspace-cleanup-scan-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupScanSnapshotModuleMock()
)
vi.mock('../workspace-space-analysis-snapshot', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceSpaceAnalysisSnapshotModuleMock()
)
vi.mock('../workspace-cleanup-removal-snapshot-prune', async () =>
  (await import('./worktrees-test-module-mocks')).workspaceCleanupRemovalSnapshotPruneModuleMock()
)
vi.mock('../runtime/worktree-teardown', async () =>
  (await import('./worktrees-test-module-mocks')).worktreeTeardownModuleMock()
)
vi.mock('./pty', async () => (await import('./worktrees-test-module-mocks')).ptyModuleMock())

type GenerationWitness = { duringAdd?: number; afterAdd?: number }

function createdRow(path: string, branch: string) {
  return { path, head: 'abc123', branch, isBare: false, isMainWorktree: false }
}

function replySequence(reply: unknown): number | undefined {
  if (typeof reply !== 'object' || reply === null || !('catalogVersion' in reply)) {
    return undefined
  }
  return isWorktreeCatalogVersion(reply.catalogVersion) ? reply.catalogVersion.sequence : undefined
}

describe('worktree create scan-generation ordering', () => {
  beforeEach(() => {
    setupWorktreeHandlers()
  })

  it('bumps the generation between a local git worktree add and the re-list after it', async () => {
    const witness: GenerationWitness = {}
    addWorktreeMock.mockImplementation(async () => {
      witness.duringAdd = getLocalWorktreeScanGeneration('repo-1')
      return {}
    })
    listWorktreesMock.mockImplementation(async () => {
      if (witness.duringAdd !== undefined && witness.afterAdd === undefined) {
        witness.afterAdd = getLocalWorktreeScanGeneration('repo-1')
      }
      return [createdRow('/workspace/ordered', 'ordered')]
    })

    const result: unknown = await handlers['worktrees:create'](null, {
      repoId: 'repo-1',
      name: 'ordered'
    })

    expect(witness.afterAdd).toBeGreaterThan(witness.duringAdd ?? Infinity)
    expect(replySequence(result)).toBeGreaterThanOrEqual(witness.afterAdd ?? Infinity)
  })

  it('bumps the generation between an SSH git worktree add and the re-list after it', async () => {
    const repo = {
      id: 'repo-ssh',
      path: '/remote/repo',
      displayName: 'ssh',
      badgeColor: '#000',
      addedAt: 0,
      connectionId: 'conn-1'
    }
    const witness: GenerationWitness = {}
    const provider = {
      exec: vi.fn(async (args: string[]) => {
        if (args[0] === 'rev-parse' || args[0] === 'show-ref') {
          throw Object.assign(new Error('missing ref'), { code: 1 })
        }
        return { stdout: '', stderr: '' }
      }),
      fetchRemoteTrackingRef: vi.fn(async () => undefined),
      addWorktree: vi.fn(async () => {
        witness.duringAdd = getLocalWorktreeScanGeneration(repo.id)
      }),
      listWorktrees: vi.fn(async () => {
        if (witness.duringAdd !== undefined && witness.afterAdd === undefined) {
          witness.afterAdd = getLocalWorktreeScanGeneration(repo.id)
        }
        return [createdRow('/remote/repo-ordered', 'refs/heads/ordered')]
      })
    }
    store.getRepos.mockReturnValue([repo])
    store.getRepo.mockReturnValue(repo)
    getSshGitProviderMock.mockReturnValue(provider)
    getActiveMultiplexerMock.mockReturnValue({
      request: vi.fn(async () => undefined),
      notify: vi.fn()
    })
    store.setWorktreeMeta.mockImplementation((_worktreeId, meta) => meta)

    const result: unknown = await handlers['worktrees:create'](null, {
      repoId: repo.id,
      name: 'ordered'
    })

    expect(provider.addWorktree).toHaveBeenCalledOnce()
    expect(witness.afterAdd).toBeGreaterThan(witness.duringAdd ?? Infinity)
    expect(replySequence(result)).toBeGreaterThanOrEqual(witness.afterAdd ?? Infinity)
  })
})
