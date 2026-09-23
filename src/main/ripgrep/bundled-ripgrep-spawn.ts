import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { wslAwareSpawn } from '../git/runner'
import { bundledRipgrepCommand, bundledRipgrepWslSpawnOptions } from './bundled-ripgrep-path'

export type BundledRipgrepSpawnOptions = SpawnOptions & {
  cwd: string
  /** Distro whose git options own this workspace; routes the spawn through wsl.exe. */
  wslDistro?: string
  /** Set when rg runs inside WSL, so it emits Linux paths the caller translates back. */
  wslDistroForOutput?: string
}

/**
 * The single way Orca spawns ripgrep: its own binary, routed into WSL when the workspace lives
 * there. Why one entry point: a bare `rg` must never reach spawn, because Windows resolves a bare
 * name in the spawn cwd — the repo — before PATH.
 */
export function spawnBundledRipgrep(
  args: string[],
  options: BundledRipgrepSpawnOptions
): ChildProcess {
  const { wslDistro, wslDistroForOutput, ...spawnOptions } = options
  const command = bundledRipgrepCommand({ wsl: Boolean(wslDistroForOutput) })
  return wslAwareSpawn(command, args, {
    ...spawnOptions,
    ...(wslDistro ? { wslDistro } : {}),
    ...(wslDistroForOutput ? bundledRipgrepWslSpawnOptions(command) : {})
  })
}
