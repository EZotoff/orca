// End-to-end correlation tests for the identity bridge are DEFERRED until
// Task 16 ships the authenticated OpenCode hook. The correlation seam
// (HookCorrelationSource) is exercised with fakes in identity-bridge.test.ts
// and identity-bridge-reconcile.test.ts; these cases need the real hook.
import { describe, test } from 'vitest'

describe('identity bridge end-to-end correlation (deferred to Task 16)', () => {
  test.todo('a real Orca-launched OpenCode PTY correlates to its sessionID + canonical root')
  test.todo('a session move rebinds only after the hook reports the new leaf')
  test.todo('an SSH-hosted PTY correlates with a host-qualified execution host id')
  test.todo('a reused terminal is rejected after the hook reports a new launch token')
})
