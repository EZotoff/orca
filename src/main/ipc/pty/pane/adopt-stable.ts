import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { Store } from '../../../persistence'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { getProvider } from '../provider/registry'
import { makePaneSpawnReservationKey, paneSpawnReservationsByOwnerKey } from './spawn-reservation'
import { awaitPaneProviderReady, type PaneProviderReadinessDeps } from './pane-provider-readiness'
import { attachStablePaneOwner, resolveStablePaneOwner, type StablePaneOwner } from './stable-owner'
import type { AdoptStablePaneArgs, AdoptStablePaneResult } from '../ipc/spawn-types'

/** No persisted or runtime owner, a live one adopted, or one the owning host saw exit. */
export type StablePaneOpen =
  | { kind: 'unowned' }
  | { kind: 'live'; adoption: AdoptStablePaneResult }
  | { kind: 'exited'; owner: StablePaneOwner }

// Why attach-only: an open parked on a pane spawn must never be joined by that spawn's own owner.
const pendingStablePaneAttachesByOwnerKey = new Map<string, Promise<StablePaneOpen>>()

async function attachResolvedStablePane(
  runtime: OrcaRuntimeService | undefined,
  store: Store | undefined,
  args: AdoptStablePaneArgs,
  paneKey: string
): Promise<StablePaneOpen> {
  const owner = resolveStablePaneOwner(runtime, store, paneKey, args.worktreeId, args.connectionId)
  if (!owner) {
    return { kind: 'unowned' }
  }
  const attached = await attachStablePaneOwner({
    runtime,
    store,
    provider: getProvider(args.connectionId),
    spawnOptions: {
      cols: args.cols,
      rows: args.rows,
      cwd: args.cwd
    },
    owner,
    worktreeId: args.worktreeId,
    connectionId: args.connectionId,
    resolveOwner: () =>
      resolveStablePaneOwner(runtime, store, paneKey, args.worktreeId, args.connectionId)
  })
  return attached.kind === 'live'
    ? { kind: 'live', adoption: { result: attached.result, owner: attached.owner } }
    : attached
}

/** The host-owned open-or-attach decision for one pane, taken once its provider is ready. */
export async function openStablePane(
  runtime: OrcaRuntimeService | undefined,
  store: Store | undefined,
  readiness: PaneProviderReadinessDeps,
  args: AdoptStablePaneArgs
): Promise<StablePaneOpen> {
  const ready = awaitPaneProviderReady(readiness, {
    connectionId: args.connectionId,
    worktreeId: args.worktreeId,
    cwd: args.cwd
  })
  if (ready) {
    await ready
  }
  const paneKey = makePaneKey(args.tabId, args.leafId)
  const ownerKey = makePaneSpawnReservationKey(args.worktreeId, args.connectionId, paneKey)
  const pendingAttach = ownerKey ? pendingStablePaneAttachesByOwnerKey.get(ownerKey) : undefined
  if (pendingAttach) {
    return await pendingAttach
  }
  const activePaneSpawn =
    ownerKey && !args.ownsPaneSpawnReservation
      ? paneSpawnReservationsByOwnerKey.get(ownerKey)
      : undefined
  if (activePaneSpawn) {
    const result = await activePaneSpawn.promise
    const owner = resolveStablePaneOwner(
      runtime,
      store,
      paneKey,
      args.worktreeId,
      args.connectionId
    )
    if (
      !owner ||
      owner.ptyId !== result.id ||
      (owner.incarnationId !== undefined &&
        result.incarnationId !== undefined &&
        owner.incarnationId !== result.incarnationId)
    ) {
      throw new Error('terminal_pane_owner_changed')
    }
    return {
      kind: 'live',
      adoption: {
        result: {
          ...result,
          isReattach: true,
          ...(owner.incarnationId ? { incarnationId: owner.incarnationId } : {})
        },
        owner,
        materialized: true as const
      }
    }
  }
  const attach = attachResolvedStablePane(runtime, store, args, paneKey)
  if (!ownerKey) {
    return await attach
  }
  pendingStablePaneAttachesByOwnerKey.set(ownerKey, attach)
  try {
    return await attach
  } finally {
    if (pendingStablePaneAttachesByOwnerKey.get(ownerKey) === attach) {
      pendingStablePaneAttachesByOwnerKey.delete(ownerKey)
    }
  }
}

export async function adoptStablePane(
  runtime: OrcaRuntimeService | undefined,
  store: Store | undefined,
  readiness: PaneProviderReadinessDeps,
  args: AdoptStablePaneArgs
): Promise<AdoptStablePaneResult | null> {
  const open = await openStablePane(runtime, store, readiness, args)
  return open.kind === 'live' ? open.adoption : null
}
