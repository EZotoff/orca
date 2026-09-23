import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import type { WorktreeCatalogVersion } from '../../../../shared/worktree/catalog-version'
import { makeDetectedResult, qualifyDetectedResult } from './worktrees-detected-listing-fixtures'
import { makeWorktree } from './worktrees-slice-test-fixtures'
import { worktreeCatalogVersionKey } from './worktrees/listing/worktree-catalog-version-state'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory
} from './worktrees-slice-test-harness'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
}))

const HOST = 'host-epoch'
const APPLIED_BY_CREATE: WorktreeCatalogVersion = { epoch: HOST, sequence: 7 }

function seed(store: ReturnType<typeof createTestStore>) {
  const created = makeWorktree({
    id: 'repo1::/path/created',
    repoId: 'repo1',
    path: '/path/created'
  })
  const surviving = makeWorktree({
    id: 'repo1::/path/surviving',
    repoId: 'repo1',
    path: '/path/surviving'
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture tabs carry only the fields the purge and teardown paths read.
  store.setState({
    repos: [
      { id: 'repo1', path: '/path/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }
    ],
    worktreesByRepo: { repo1: [created, surviving] },
    detectedWorktreesByRepo: { repo1: makeDetectedResult('repo1', [created, surviving]) },
    tabsByWorktree: { [created.id]: [{ id: 'tab-created', worktreeId: created.id }] },
    // The create reply that produced `created` has been applied at sequence 7.
    worktreeCatalogVersionByRepoHost: {
      [worktreeCatalogVersionKey('repo1', 'local')]: APPLIED_BY_CREATE
    }
  } as unknown as Partial<AppState>)
  return { created, surviving }
}

// Why this suite exists: the teardown RPC runs before the merge, so a listing the merge would
// refuse must be refused before it stops any terminals, judged against the live applied version.
describe('fetchWorktrees with a listing versioned before an applied create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
    resetWorktreeSliceModuleMemory()
  })

  it("neither tears down the created worktree's terminals nor purges it", async () => {
    const store = createTestStore()
    const { created, surviving } = seed(store)
    mockApi.worktrees.listDetected.mockImplementationOnce(async (args) =>
      qualifyDetectedResult(
        args,
        makeDetectedResult('repo1', [surviving], { catalogVersion: { epoch: HOST, sequence: 6 } })
      )
    )

    await store.getState().fetchWorktrees('repo1')

    expect(mockApi.runtime.call).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'worktree.teardownMissingTerminals' })
    )
    expect(store.getState().worktreesByRepo.repo1?.map((w) => w.id)).toEqual([
      created.id,
      surviving.id
    ])
    expect(store.getState().tabsByWorktree[created.id]).toBeDefined()
    expect(
      store.getState().worktreeCatalogVersionByRepoHost[worktreeCatalogVersionKey('repo1', 'local')]
    ).toEqual(APPLIED_BY_CREATE)
  })

  it('control: a listing versioned after the create tears down and purges as before', async () => {
    const store = createTestStore()
    const { created, surviving } = seed(store)
    mockApi.worktrees.listDetected.mockImplementationOnce(async (args) =>
      qualifyDetectedResult(
        args,
        makeDetectedResult('repo1', [surviving], { catalogVersion: { epoch: HOST, sequence: 8 } })
      )
    )

    await store.getState().fetchWorktrees('repo1')

    expect(mockApi.runtime.call).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'worktree.teardownMissingTerminals',
        params: expect.objectContaining({ repo: 'repo1', worktreeIds: [created.id] })
      })
    )
    expect(store.getState().worktreesByRepo.repo1?.map((w) => w.id)).toEqual([surviving.id])
    expect(
      store.getState().worktreeCatalogVersionByRepoHost[worktreeCatalogVersionKey('repo1', 'local')]
    ).toEqual({ epoch: HOST, sequence: 8 })
  })
})
