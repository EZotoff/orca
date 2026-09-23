import { describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { SessionNotFoundError, TerminalSessionOwnerUnverifiedError } from '../daemon/daemon-errors'
import { makePaneKey } from '../../shared/stable-pane-id'
import { registerPtyHandlers, setLocalPtyProvider } from './pty'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

type SpawnOptions = {
  attachOnly?: boolean
  command?: string
  sessionId?: string
  isNewSession?: boolean
}

function installProvider(spawn: (options: SpawnOptions) => Promise<unknown>): void {
  const provider = {
    spawn,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    shutdown: vi.fn(),
    sendSignal: vi.fn(),
    getCwd: vi.fn(),
    getInitialCwd: vi.fn(),
    clearBuffer: vi.fn(),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(),
    getForegroundProcess: vi.fn(),
    serialize: vi.fn(),
    revive: vi.fn(),
    onData: vi.fn(() => () => {}),
    onReplay: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
    listProcesses: vi.fn(async () => []),
    attach: vi.fn(),
    getDefaultShell: vi.fn(),
    getProfiles: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a partial daemon-host double; LocalPtyProvider would flip the spawn to the in-process path.
  setLocalPtyProvider(provider as never)
}

function paneFixture(name: string, options: { ptyId?: string; tabLevelOnly?: boolean } = {}) {
  const worktreeId = `repo-1::/tmp/${name}`
  const tabId = `tab-${name}`
  const leafId = '45454545-4545-4545-8545-454545454545'
  const paneKey = makePaneKey(tabId, leafId)
  const ptyId = options.ptyId ?? `${worktreeId}@@0a0b0c0d`
  let session = {
    tabsByWorktree: { [worktreeId]: [{ id: tabId, worktreeId, ptyId }] },
    terminalLayoutsByTabId: options.tabLevelOnly
      ? {}
      : {
          [tabId]: {
            root: { type: 'leaf' as const, leafId },
            activeLeafId: leafId,
            expandedLeafId: null,
            ptyIdsByLeafId: { [leafId]: ptyId }
          }
        },
    terminalPtyIncarnationsByPaneKey: { [paneKey]: `inc-${name}` }
  }
  const store = {
    getWorkspaceSession: vi.fn(() => session),
    setWorkspaceSession: vi.fn((next) => {
      session = next
    }),
    flushOrThrow: vi.fn(),
    persistPtyBinding: vi.fn(),
    getFolderWorkspace: vi.fn(() => undefined),
    getFolderWorkspaces: vi.fn(() => []),
    getProjectGroups: vi.fn(() => []),
    getRepos: vi.fn(() => [])
  }
  const runtime = {
    setPtyController: vi.fn(),
    resolveTerminalPane: vi.fn(() => {
      throw new Error('terminal_not_found')
    }),
    createPreAllocatedTerminalHandle: vi.fn(() => `term-${name}`),
    preAllocateHandleForPty: vi.fn(() => `term-${name}`),
    registerPreAllocatedHandleForPty: vi.fn(),
    beginPtyRegistration: vi.fn(),
    cancelPendingPtyRegistration: vi.fn(),
    assertPtyRegistrationAllowed: vi.fn(),
    preparePtyExecutionContext: vi.fn(() => true),
    registerPty: vi.fn(),
    noteTerminalSpawnCommand: vi.fn(),
    seedHeadlessTerminal: vi.fn(),
    onPtySpawned: vi.fn(),
    onPtyExit: vi.fn(),
    onPtyData: vi.fn()
  }
  const spawnArgs = {
    cols: 80,
    rows: 24,
    cwd: `/tmp/${name}`,
    worktreeId,
    tabId,
    leafId,
    env: { ORCA_PANE_KEY: paneKey, ORCA_TAB_ID: tabId, ORCA_WORKTREE_ID: worktreeId }
  }
  const incarnationId = `inc-${name}`
  return { worktreeId, tabId, leafId, paneKey, ptyId, incarnationId, store, runtime, spawnArgs }
}

describe('host-owned terminal open-or-attach', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()

  function register(
    fixture: ReturnType<typeof paneFixture>,
    options?: Parameters<typeof registerPtyHandlers>[6]
  ): void {
    registerPtyHandlers(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the suite's BrowserWindow double, shared by every pty IPC suite.
      mainWindow as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: runtime double covering only the registration calls pty:spawn makes.
      fixture.runtime as never,
      undefined,
      undefined,
      undefined,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: store double covering only the session reads and writes pty:spawn makes.
      fixture.store as never,
      options
    )
  }

  it('recreates a proven-exited pane with the same session id and a new incarnation', async () => {
    const fixture = paneFixture('same-id-recreate')
    const providerSpawn = vi.fn(async (options: SpawnOptions) => {
      if (options.attachOnly) {
        throw new SessionNotFoundError(fixture.ptyId)
      }
      return { id: fixture.ptyId, incarnationId: 'inc-recreated' }
    })
    installProvider(providerSpawn)
    register(fixture)

    const mounted = await handlers.get('pty:spawn')!(null, fixture.spawnArgs)

    expect(mounted).toMatchObject({ id: fixture.ptyId })
    expect(providerSpawn).toHaveBeenCalledTimes(2)
    const recreate = providerSpawn.mock.calls[1]?.[0]
    expect(recreate).toMatchObject({ sessionId: fixture.ptyId })
    // Without isNewSession the daemon probes the session's history and cold-restores it.
    expect(recreate).not.toHaveProperty('isNewSession')
    expect(recreate).not.toHaveProperty('attachOnly')
    expect(fixture.runtime.preparePtyExecutionContext).toHaveBeenCalledWith(fixture.ptyId, null, {
      resetIncarnation: true,
      preserveExisting: false
    })
    expect(fixture.runtime.onPtyExit).toHaveBeenCalledWith(
      fixture.ptyId,
      -1,
      'inc-same-id-recreate',
      { hostExitConfirmed: true }
    )
  })

  it('reattaches a live owner without spawning anything', async () => {
    const fixture = paneFixture('live-owner')
    const providerSpawn = vi.fn(async () => ({
      id: fixture.ptyId,
      incarnationId: fixture.incarnationId,
      isReattach: true
    }))
    installProvider(providerSpawn)
    register(fixture)

    const mounted = await handlers.get('pty:spawn')!(null, fixture.spawnArgs)

    expect(mounted).toMatchObject({ id: fixture.ptyId, isReattach: true })
    expect(providerSpawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: fixture.ptyId, attachOnly: true, command: undefined })
    )
    expect(fixture.runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('adopts a tab-level-only row the renderer has not republished yet', async () => {
    const fixture = paneFixture('tab-level-only', { tabLevelOnly: true })
    const providerSpawn = vi.fn(async () => ({
      id: fixture.ptyId,
      incarnationId: fixture.incarnationId,
      isReattach: true
    }))
    installProvider(providerSpawn)
    register(fixture)

    const mounted = await handlers.get('pty:spawn')!(null, fixture.spawnArgs)

    expect(mounted).toMatchObject({ id: fixture.ptyId, isReattach: true })
    expect(providerSpawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: fixture.ptyId, attachOnly: true })
    )
  })

  it('answers unverifiable and keeps the binding when the owner cannot be verified', async () => {
    const fixture = paneFixture('owner-unverified')
    const providerSpawn = vi.fn(async () => {
      throw new TerminalSessionOwnerUnverifiedError(fixture.ptyId)
    })
    installProvider(providerSpawn)
    register(fixture)

    await expect(handlers.get('pty:spawn')!(null, fixture.spawnArgs)).rejects.toThrow(
      'terminal_pane_owner_unverified'
    )

    expect(providerSpawn).toHaveBeenCalledTimes(1)
    expect(fixture.store.setWorkspaceSession).not.toHaveBeenCalled()
    expect(fixture.runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('answers an SSH pane with no connection without spawning or retiring it', async () => {
    const fixture = paneFixture('ssh-no-connection', { ptyId: 'ssh:conn-offline@@pty-1' })
    const providerSpawn = vi.fn(async () => ({ id: 'local-should-not-spawn' }))
    installProvider(providerSpawn)
    register(fixture)

    await expect(
      handlers.get('pty:spawn')!(null, { ...fixture.spawnArgs, connectionId: 'conn-offline' })
    ).rejects.toThrow('No PTY provider for connection "conn-offline"')

    expect(providerSpawn).not.toHaveBeenCalled()
    expect(fixture.store.setWorkspaceSession).not.toHaveBeenCalled()
    expect(fixture.runtime.onPtyExit).not.toHaveBeenCalled()
  })

  it('holds pty:spawn until the local provider startup settles', async () => {
    const fixture = paneFixture('spawn-waits')
    let releaseStartup!: () => void
    const startup = new Promise<void>((resolve) => {
      releaseStartup = resolve
    })
    const providerSpawn = vi.fn(async () => ({
      id: fixture.ptyId,
      incarnationId: fixture.incarnationId,
      isReattach: true
    }))
    installProvider(providerSpawn)
    register(fixture, { awaitLocalPtyStartup: () => startup })

    const mounted = handlers.get('pty:spawn')!(null, fixture.spawnArgs)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(providerSpawn).not.toHaveBeenCalled()

    releaseStartup()
    await expect(mounted).resolves.toMatchObject({ id: fixture.ptyId })
  })

  it('holds runtime terminal.create adoption until the local provider startup settles', async () => {
    const fixture = paneFixture('runtime-adopt-waits')
    let releaseStartup!: () => void
    const startup = new Promise<void>((resolve) => {
      releaseStartup = resolve
    })
    const providerSpawn = vi.fn(async () => ({
      id: fixture.ptyId,
      incarnationId: fixture.incarnationId,
      isReattach: true
    }))
    installProvider(providerSpawn)
    register(fixture, { awaitLocalPtyStartup: () => startup })
    const controller = fixture.runtime.setPtyController.mock.calls[0]?.[0]

    const adopted = controller.adoptStablePane({
      cols: 120,
      rows: 40,
      cwd: fixture.spawnArgs.cwd,
      connectionId: null,
      worktreeId: fixture.worktreeId,
      tabId: fixture.tabId,
      leafId: fixture.leafId
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(providerSpawn).not.toHaveBeenCalled()

    releaseStartup()
    await expect(adopted).resolves.toMatchObject({ result: { id: fixture.ptyId } })
    expect(providerSpawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionId: fixture.ptyId, attachOnly: true })
    )
  })
})
