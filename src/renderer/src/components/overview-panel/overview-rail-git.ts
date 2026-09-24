import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'

/**
 * Widget 4 (orca-transition Task 11, design §7): per-project dirty/branch
 * indicator for the persistent rail. Pure derivation over the SAME data the
 * sidebar git indicators use — `worktree.branch`/`head` via
 * getWorktreeGitIdentityDisplay and the editor-git slice's status entries —
 * so the rail never re-reads git itself.
 */
export type RailGitIndicator = {
  /** Short branch label for the narrow rail column (detached head falls back to shortHead). */
  label: string
  /** True when the project worktree has uncommitted changes. */
  dirty: boolean
  /** Number of dirty entries when known (tooltip detail only). */
  dirtyCount: number
}

const MAX_RAIL_LABEL_LENGTH = 8

export function deriveRailGitIndicator(input: {
  branch?: string | null
  head?: string | null
  dirtyCount: number
}): RailGitIndicator | null {
  const identity = getWorktreeGitIdentityDisplay(input)
  if (identity === null) {
    return null
  }
  const fullLabel = identity.kind === 'branch' ? identity.branchName : identity.shortHead
  return {
    label:
      fullLabel.length > MAX_RAIL_LABEL_LENGTH
        ? `${fullLabel.slice(0, MAX_RAIL_LABEL_LENGTH - 1)}…`
        : fullLabel,
    dirty: input.dirtyCount > 0,
    dirtyCount: input.dirtyCount
  }
}
