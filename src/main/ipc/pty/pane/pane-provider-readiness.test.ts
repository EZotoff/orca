import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { getSshProviderAuthority } from '../../../ssh/ssh-provider-authority'
import { connectInFlight } from '../../ssh-connect-attempt-registry'
import { awaitPaneProviderReady, type PaneProviderReadinessDeps } from './pane-provider-readiness'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settles(promise: Promise<void> | undefined): Promise<boolean> {
  if (!promise) {
    return true
  }
  let settled = false
  void promise.then(() => {
    settled = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

function registerConnect(targetId: string, settled: Promise<void>): void {
  const state: SshConnectionState = {
    targetId,
    status: 'connected',
    error: null,
    reconnectAttempt: 0
  }
  connectInFlight.set(targetId, {
    authority: getSshProviderAuthority(targetId),
    promise: settled.then(() => state)
  })
}

const originalPlatform = process.platform
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  onPlatform(originalPlatform)
  connectInFlight.clear()
})

describe('awaitPaneProviderReady', () => {
  it('holds a local pane until the local provider startup settles', async () => {
    const startup = deferred()
    const deps: PaneProviderReadinessDeps = { getLocalPtyStartupPromise: () => startup.promise }

    const ready = awaitPaneProviderReady(deps, { worktreeId: 'repo::/tmp/wt' })

    expect(await settles(ready)).toBe(false)
    startup.resolve()
    expect(await settles(ready)).toBe(true)
  })

  it('answers synchronously when nothing is pending', () => {
    expect(
      awaitPaneProviderReady(
        { getLocalPtyStartupPromise: () => undefined },
        { worktreeId: 'r::/w' }
      )
    ).toBeUndefined()
  })

  it('also holds a WSL shell pane behind the managed WSL CLI barrier', async () => {
    onPlatform('win32')
    const barrier = deferred()
    const getManagedWslCliStartupBarrier = vi.fn(() => barrier.promise)
    const deps: PaneProviderReadinessDeps = {
      getLocalPtyStartupPromise: () => Promise.resolve(),
      getManagedWslCliStartupBarrier
    }

    const ready = awaitPaneProviderReady(deps, { worktreeId: 'r::C:\\w', shellOverride: 'wsl.exe' })

    expect(await settles(ready)).toBe(false)
    barrier.resolve()
    expect(await settles(ready)).toBe(true)
  })

  it('treats a WSL UNC workspace as a WSL pane even with the host shell', async () => {
    onPlatform('win32')
    const barrier = deferred()
    const ready = awaitPaneProviderReady(
      {
        getLocalPtyStartupPromise: () => undefined,
        getManagedWslCliStartupBarrier: () => barrier.promise
      },
      { worktreeId: 'r::\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', shellOverride: 'cmd.exe' }
    )

    expect(await settles(ready)).toBe(false)
    barrier.resolve()
    expect(await settles(ready)).toBe(true)
  })

  it('does not hold a native Windows shell pane behind the WSL barrier', () => {
    onPlatform('win32')
    const getManagedWslCliStartupBarrier = vi.fn(() => new Promise<void>(() => {}))

    const ready = awaitPaneProviderReady(
      { getLocalPtyStartupPromise: () => undefined, getManagedWslCliStartupBarrier },
      { worktreeId: 'r::C:\\w', shellOverride: 'powershell.exe' }
    )

    expect(ready).toBeUndefined()
    expect(getManagedWslCliStartupBarrier).not.toHaveBeenCalled()
  })

  it('joins an SSH connect already in flight and ignores the local provider', async () => {
    const connect = deferred()
    registerConnect('target-1', connect.promise)
    const getLocalPtyStartupPromise = vi.fn(() => new Promise<void>(() => {}))

    const ready = awaitPaneProviderReady(
      { getLocalPtyStartupPromise },
      { connectionId: 'target-1', worktreeId: 'r::/w' }
    )

    expect(await settles(ready)).toBe(false)
    connect.resolve()
    expect(await settles(ready)).toBe(true)
    expect(getLocalPtyStartupPromise).not.toHaveBeenCalled()
  })

  it('lets a failed SSH connect through so the missing provider answers unverifiable', async () => {
    const connect = deferred()
    registerConnect('target-1', connect.promise)

    const ready = awaitPaneProviderReady(
      { getLocalPtyStartupPromise: () => undefined },
      { connectionId: 'target-1' }
    )
    connect.reject(new Error('auth failed'))

    await expect(ready).resolves.toBeUndefined()
  })

  it('never dials an SSH target that has no connect in flight', () => {
    // Why: passphrase and runtime-owned targets must stay user-driven; this op has no dialer at all.
    expect(
      awaitPaneProviderReady(
        { getLocalPtyStartupPromise: () => undefined },
        { connectionId: 'passphrase-target' }
      )
    ).toBeUndefined()
    expect(connectInFlight.has('passphrase-target')).toBe(false)
  })
})
