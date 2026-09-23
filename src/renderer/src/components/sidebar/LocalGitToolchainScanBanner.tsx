import React from 'react'
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import {
  isMachineWideLocalScanFailure,
  resolveRepoScanFailure
} from './worktree-list/rows/repo-scan-failure-kind'

const FIX_COMMANDS = {
  'xcode-license': 'sudo xcodebuild -license accept',
  'developer-tools': 'xcode-select --install'
} as const

type BlockedKind = keyof typeof FIX_COMMANDS

function isBlockedKind(kind: string): kind is BlockedKind {
  return kind in FIX_COMMANDS
}

function findBlockedRepos(
  repos: readonly Repo[],
  detectedByRepo: ReturnType<typeof useAppStore.getState>['detectedWorktreesByRepo']
): { kind: BlockedKind; repos: Repo[] } | null {
  const blocked: Repo[] = []
  let kind: BlockedKind | null = null
  for (const repo of repos) {
    const failure = resolveRepoScanFailure(repo, detectedByRepo[repo.id])
    if (!failure || !isMachineWideLocalScanFailure(failure) || !isBlockedKind(failure.kind)) {
      continue
    }
    blocked.push(repo)
    // Why: the license is only reachable once the tools exist, so a missing-tools repo leads.
    if (kind !== 'developer-tools') {
      kind = failure.kind
    }
  }
  return kind ? { kind, repos: blocked } : null
}

/** One sidebar-level notice for local Git toolchain failures that block every local repo at once. */
export function LocalGitToolchainScanBanner(): React.JSX.Element | null {
  const repos = useAppStore((s) => s.repos)
  const detectedByRepo = useAppStore((s) => s.detectedWorktreesByRepo)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const blocked = React.useMemo(
    () => findBlockedRepos(repos, detectedByRepo),
    [repos, detectedByRepo]
  )
  const [pending, setPending] = React.useState(false)
  const pendingRef = React.useRef(false)

  const retry = React.useCallback(
    async (source: 'button' | 'focus') => {
      if (!blocked || pendingRef.current) {
        return
      }
      pendingRef.current = true
      setPending(true)
      try {
        await Promise.allSettled(
          blocked.repos.map((repo) => fetchWorktrees(repo.id, { executionHostId: 'local' }))
        )
      } finally {
        pendingRef.current = false
        setPending(false)
      }
      const state = useAppStore.getState()
      const stillBlocked = findBlockedRepos(state.repos, state.detectedWorktreesByRepo)
      if (!stillBlocked) {
        const count = blocked.repos.length
        toast.success(
          count === 1
            ? translate(
                'auto.components.sidebar.LocalGitToolchainScanBanner.restoredOne',
                'Worktree scan restored for {{value0}}',
                { value0: blocked.repos[0].displayName }
              )
            : translate(
                'auto.components.sidebar.LocalGitToolchainScanBanner.restoredMany',
                'Worktree scan restored for {{value0}} projects',
                { value0: count }
              )
        )
      } else if (source === 'button') {
        toast.error(
          translate(
            'auto.components.sidebar.LocalGitToolchainScanBanner.stillBlocked',
            'Git is still blocked. Finish the command in Terminal and try again.'
          )
        )
      }
    },
    [blocked, fetchWorktrees]
  )

  const hasBlocked = blocked !== null
  React.useEffect(() => {
    if (!hasBlocked) {
      return
    }
    // Why: the fix happens in another app, so returning to Orca is the natural moment to rescan.
    const onReturn = (): void => {
      if (document.visibilityState === 'visible') {
        void retry('focus')
      }
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [hasBlocked, retry])

  if (!blocked) {
    return null
  }
  const command = FIX_COMMANDS[blocked.kind]
  const title =
    blocked.kind === 'xcode-license'
      ? translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.xcodeLicenseTitle',
          'Accept the Xcode license to use Git'
        )
      : translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.developerToolsTitle',
          "Install Apple's command line tools"
        )
  const body =
    blocked.kind === 'xcode-license'
      ? translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.xcodeLicenseBody',
          'macOS blocks Git until you accept it. Run this in Terminal, then switch back to Orca. It will check again automatically.'
        )
      : translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.developerToolsBody',
          "Git needs Apple's developer tools. Run this in Terminal, then switch back to Orca. It will check again automatically."
        )
  const affected =
    blocked.repos.length === 1
      ? translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.affectedOne',
          'Worktree scan paused for {{value0}}',
          { value0: blocked.repos[0].displayName }
        )
      : translate(
          'auto.components.sidebar.LocalGitToolchainScanBanner.affectedMany',
          'Worktree scan paused for {{value0}} projects',
          { value0: blocked.repos.length }
        )

  return (
    <section
      role="alert"
      aria-busy={pending}
      className="mx-2 mb-2 shrink-0 rounded-md border border-destructive/50 bg-worktree-sidebar-accent/40 p-2.5 text-worktree-sidebar-foreground"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-semibold leading-snug">{title}</p>
          <p className="text-xs leading-snug text-muted-foreground">{body}</p>
          <code className="block select-all break-words rounded bg-muted px-1.5 py-1 font-mono text-[11px] text-foreground">
            {command}
          </code>
          <p className="truncate text-[11px] text-muted-foreground">{affected}</p>
          <div className="flex items-center gap-1.5 pt-0.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                void window.api.ui
                  .writeClipboardText(command)
                  .then(() =>
                    toast.success(
                      translate(
                        'auto.components.sidebar.LocalGitToolchainScanBanner.copied',
                        'Command copied'
                      )
                    )
                  )
              }}
            >
              <Copy aria-hidden="true" />
              {translate(
                'auto.components.sidebar.LocalGitToolchainScanBanner.copyCommand',
                'Copy command'
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={pending}
              onClick={() => void retry('button')}
            >
              <RefreshCw className={cn(pending && 'animate-spin')} aria-hidden="true" />
              {pending
                ? translate(
                    'auto.components.sidebar.LocalGitToolchainScanBanner.retrying',
                    'Retrying…'
                  )
                : translate(
                    'auto.components.sidebar.LocalGitToolchainScanBanner.retry',
                    'Retry now'
                  )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
