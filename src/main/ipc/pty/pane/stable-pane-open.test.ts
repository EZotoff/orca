import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { SessionNotFoundError } from '../../../daemon/daemon-errors'
import type { Store } from '../../../persistence'
import { createStore, makeTerminalTab, testState } from '../../../persistence-test-harness'
import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from '../../../providers/types'
import { attachStablePaneOwner, resolvePersistedStablePaneOwner } from './stable-owner'
import { MAX_CONCURRENT_STABLE_PANE_OPENS } from './stable-pane-open-lane'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('node-pty', () => ({ spawn: vi.fn(), default: { spawn: vi.fn() } }))

const WORKTREE = 'repo-1::/tmp/stable-pane-open'
const TAB = 'tab-1'
const LEAF = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
const PTY_ID = `${WORKTREE}@@a1b2c3d4`
const OWNER = { tabId: TAB, leafId: LEAF, ptyId: PTY_ID, hasPersistedBinding: true as const }

/** A provider whose only live surface is the attach probe under test. */
class ProbeProvider extends LocalPtyProvider {
  constructor(private readonly probe: (options: PtySpawnOptions) => Promise<PtySpawnResult>) {
    super()
  }

  override spawn(options: PtySpawnOptions): Promise<PtySpawnResult> {
    return this.probe(options)
  }
}

function boundPaneStore(): Store {
  const store = createStore()
  store.setWorkspaceSession({
    ...store.getWorkspaceSession(),
    tabsByWorktree: {
      [WORKTREE]: [makeTerminalTab({ id: TAB, ptyId: PTY_ID, worktreeId: WORKTREE })]
    },
    terminalLayoutsByTabId: {
      [TAB]: {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: PTY_ID }
      }
    }
  })
  return store
}

function boundOwner(store: Store) {
  return resolvePersistedStablePaneOwner(store, makePaneKey(TAB, LEAF), WORKTREE, null)
}

function attach(provider: IPtyProvider, store: Store) {
  return attachStablePaneOwner({
    runtime: undefined,
    store,
    provider,
    spawnOptions: { cols: 80, rows: 24 },
    owner: OWNER,
    worktreeId: WORKTREE,
    connectionId: null,
    resolveOwner: () => null
  })
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'orca-stable-pane-open-'))
})

afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('a pre-daemon in-process answer for a restored pane', () => {
  it('is unverifiable and leaves the binding while the daemon may still own the id', async () => {
    const store = boundPaneStore()
    const provider = new LocalPtyProvider({ ownsUnspawnedSessionIds: () => false })

    await expect(attach(provider, store)).rejects.toThrow('terminal_pane_owner_unverified')

    expect(boundOwner(store)).toMatchObject({ ptyId: PTY_ID })
  })

  it('still certifies the exit once the in-process provider is the settled owner', async () => {
    const store = boundPaneStore()
    const provider = new LocalPtyProvider({ ownsUnspawnedSessionIds: () => true })

    await expect(attach(provider, store)).resolves.toMatchObject({ kind: 'exited' })

    expect(boundOwner(store)).toBeNull()
  })

  it('treats a daemon absence answer as observed exit evidence', async () => {
    const provider = new ProbeProvider(async () => {
      throw new SessionNotFoundError(PTY_ID)
    })

    await expect(attach(provider, boundPaneStore())).resolves.toMatchObject({ kind: 'exited' })
  })
})

describe('the stable pane open lane', () => {
  it('bounds concurrent owner probes and drains the queue', async () => {
    let inFlight = 0
    let peak = 0
    const releases: (() => void)[] = []
    const spawn = vi.fn(
      () =>
        new Promise<PtySpawnResult>((resolve) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          releases.push(() => {
            inFlight -= 1
            resolve({ id: PTY_ID, isReattach: true })
          })
        })
    )
    const provider = new ProbeProvider(spawn)
    const store = boundPaneStore()
    const opens = Array.from({ length: MAX_CONCURRENT_STABLE_PANE_OPENS + 2 }, () =>
      attach(provider, store)
    )

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(MAX_CONCURRENT_STABLE_PANE_OPENS))
    expect(peak).toBe(MAX_CONCURRENT_STABLE_PANE_OPENS)
    while (releases.length > 0) {
      releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    await expect(Promise.all(opens)).resolves.toHaveLength(MAX_CONCURRENT_STABLE_PANE_OPENS + 2)
    expect(spawn).toHaveBeenCalledTimes(MAX_CONCURRENT_STABLE_PANE_OPENS + 2)
    expect(peak).toBe(MAX_CONCURRENT_STABLE_PANE_OPENS)
  })
})
