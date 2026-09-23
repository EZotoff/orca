// The verdict on a provider child's start, for a caller that must not act on an unproven one.
//
// A publish-first attach hands the host a child that has answered nothing yet. Whether it proves
// its start or dies first arrives later, as a `started` or `ended` event settled on the session's
// own queue. A send admitted against that child would be dispatched into a process that may be
// about to die, and learn of the death only as a delivery nobody can confirm. So the send
// registers here and waits OFF the queue: the settlement that flips the child to `ready` answers
// `ready`, the exit settlement answers `exited` with the child's own reason, and a close, an
// eviction or a replacement answers `gone`. There is no timer — a child either proves its start
// or exits, and the host observes both.

export type StructuredAgentSessionProviderChildIdentity = {
  fence: number
  acquisitionGeneration: string
}

export type StructuredAgentSessionStartupVerdict =
  | { verdict: 'ready' }
  | { verdict: 'exited'; reason: string }
  /** The child was stopped, evicted or replaced before it proved anything. */
  | { verdict: 'gone' }

type StartupWaiter = {
  child: StructuredAgentSessionProviderChildIdentity
  settle: (verdict: StructuredAgentSessionStartupVerdict) => void
}

export class StructuredAgentSessionStartupWatch {
  private readonly waiters = new Map<string, Set<StartupWaiter>>()

  /** For a caller inside the session's serialize: the verdict settles on a later step of that
   *  queue, so it cannot land before this registers. Settles exactly once. */
  awaitVerdict(
    sessionId: string,
    child: StructuredAgentSessionProviderChildIdentity
  ): Promise<StructuredAgentSessionStartupVerdict> {
    return new Promise((settle) => {
      const waiting = this.waiters.get(sessionId) ?? new Set()
      waiting.add({ child, settle })
      this.waiters.set(sessionId, waiting)
    })
  }

  proven(sessionId: string, child: StructuredAgentSessionProviderChildIdentity): void {
    this.settle(sessionId, child, { verdict: 'ready' })
  }

  exited(
    sessionId: string,
    child: StructuredAgentSessionProviderChildIdentity,
    reason: string
  ): void {
    this.settle(sessionId, child, { verdict: 'exited', reason })
  }

  /** The session's entry is gone or replaced: no child it held will prove anything now. */
  dropped(sessionId: string): void {
    this.settle(sessionId, null, { verdict: 'gone' })
  }

  dispose(): void {
    for (const sessionId of this.waiters.keys()) {
      this.dropped(sessionId)
    }
  }

  private settle(
    sessionId: string,
    child: StructuredAgentSessionProviderChildIdentity | null,
    verdict: StructuredAgentSessionStartupVerdict
  ): void {
    const waiting = this.waiters.get(sessionId)
    if (!waiting) {
      return
    }
    for (const waiter of waiting) {
      if (
        child &&
        (waiter.child.fence !== child.fence ||
          waiter.child.acquisitionGeneration !== child.acquisitionGeneration)
      ) {
        continue
      }
      waiting.delete(waiter)
      waiter.settle(verdict)
    }
    if (waiting.size === 0) {
      this.waiters.delete(sessionId)
    }
  }
}
