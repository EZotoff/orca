import { describe, expect, it } from 'vitest'
import { StructuredAgentSessionStartupWatch } from './structured-agent-session-startup-watch'

const SESSION = 'session-1'
const CHILD = { fence: 3, acquisitionGeneration: 'generation-3' }

describe('the startup watch', () => {
  it('answers ready to a waiter on the child that proved its start', async () => {
    const watch = new StructuredAgentSessionStartupWatch()
    const verdict = watch.awaitVerdict(SESSION, CHILD)

    watch.proven(SESSION, CHILD)

    await expect(verdict).resolves.toEqual({ verdict: 'ready' })
  })

  it('answers exited, with the reason, to a waiter on the child that exited', async () => {
    const watch = new StructuredAgentSessionStartupWatch()
    const verdict = watch.awaitVerdict(SESSION, CHILD)

    watch.exited(SESSION, CHILD, 'not signed in')

    await expect(verdict).resolves.toEqual({ verdict: 'exited', reason: 'not signed in' })
  })

  it('ignores a verdict on another child of the same session', async () => {
    const watch = new StructuredAgentSessionStartupWatch()
    const verdict = watch.awaitVerdict(SESSION, CHILD)
    let settled = false
    void verdict.then(() => {
      settled = true
    })

    watch.proven(SESSION, { fence: 2, acquisitionGeneration: 'generation-2' })
    watch.exited(SESSION, { fence: 3, acquisitionGeneration: 'generation-2' }, 'other')
    await Promise.resolve()

    expect(settled).toBe(false)
    watch.dropped(SESSION)
    await expect(verdict).resolves.toEqual({ verdict: 'gone' })
  })

  it('answers gone to every waiter of a dropped session, and to all on dispose', async () => {
    const watch = new StructuredAgentSessionStartupWatch()
    const first = watch.awaitVerdict(SESSION, CHILD)
    const second = watch.awaitVerdict(SESSION, { fence: 4, acquisitionGeneration: 'generation-4' })
    const other = watch.awaitVerdict('session-2', CHILD)

    watch.dropped(SESSION)
    await expect(first).resolves.toEqual({ verdict: 'gone' })
    await expect(second).resolves.toEqual({ verdict: 'gone' })

    watch.dispose()
    await expect(other).resolves.toEqual({ verdict: 'gone' })
  })

  it('settles each waiter once', async () => {
    const watch = new StructuredAgentSessionStartupWatch()
    const verdict = watch.awaitVerdict(SESSION, CHILD)

    watch.proven(SESSION, CHILD)
    watch.exited(SESSION, CHILD, 'later')
    watch.dropped(SESSION)

    await expect(verdict).resolves.toEqual({ verdict: 'ready' })
  })
})
