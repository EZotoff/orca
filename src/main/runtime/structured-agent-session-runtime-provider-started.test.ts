// Every provider's lifecycle events share one recovery chain in the runtime. A Claude child
// proving its start must not make that chain, or the session's own serialized operations,
// wait on the CLI: the host records what the child proved from what the adapter already holds.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForStructuredAgentSessionRecovery } from './structured-agent-session-runtime'
import { createScriptedClaudeRuntime } from './structured-claude-scripted-runtime-test-support'

const STALLED = 'claude-started-stalled'
const HEALTHY = 'claude-started-healthy'
const CALLER = { callerKey: 'client-1' }

let claude = createScriptedClaudeRuntime([STALLED, HEALTHY])

afterEach(async () => {
  await claude.dispose()
  claude = createScriptedClaudeRuntime([STALLED, HEALTHY])
})

describe('a Claude child proving its start', () => {
  it("never holds another session's exit recovery, or its own close, on a CLI read", async () => {
    claude.behave(STALLED, { stallsControlReads: true })
    const host = await claude.install()

    await expect(host.attach(CALLER, claude.attachParams(HEALTHY, null))).resolves.toMatchObject({
      ok: true
    })
    await waitForStructuredAgentSessionRecovery()

    // This child answers startup, then never answers another control read.
    await expect(host.attach(CALLER, claude.attachParams(STALLED, null))).resolves.toMatchObject({
      ok: true
    })
    await vi.waitFor(() => expect(claude.child(STALLED).calls).toContain('get_settings'))
    // Its `started` reaches the shared chain ahead of the exit below.
    await new Promise((resolve) => setImmediate(resolve))

    claude.child(HEALTHY).exit(new Error('claude stream-json exited (code 1): crashed'))
    await vi.waitFor(() =>
      expect(host.deps.store.getRecord(HEALTHY)?.lease.claimStatus).toBe('released')
    )

    // What the child proved is still recorded, from the startup it already answered.
    await vi.waitFor(() =>
      expect(host.deps.store.getRecord(STALLED)?.options).toEqual({
        model: 'claude-sonnet-5',
        effort: 'high'
      })
    )
    expect(claude.child(STALLED).calls).toEqual(['get_settings'])

    let closed = false
    void host.close(STALLED).then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(closed).toBe(true))
  })
})
