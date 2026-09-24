// Why: Task 16 — startup-facing wrapper for the guarded global-hook installer. Runs lazily
// from the first-window startup path (never at module init), gated OFF by default: live
// install is Task 17/18 territory behind the operator's authorization flow, so this only
// activates when ORCA_ENABLE_GLOBAL_HOOK_INSTALL=1 is explicitly set. Also performs the
// design-§6 startup digest self-check (log-only warning on mismatch — the live-config guard
// does not cover ~/.config/opencode/plugins/, per spikes/g3-guard-probe.md).

import { join } from 'node:path'
import {
  installGlobalOpenCodeHook,
  verifyGlobalOpenCodeHook,
  type GlobalHookVerifyStatus
} from './global-hook-installer'
import {
  buildGlobalHookChildEnv,
  createGlobalHookIdentityToken
} from './global-hook-env'
import { createProcfsProcessIdentityReader } from './global-hook-consumer-registry'
  import {
  registerGlobalHookConsumer,
  reconcileGlobalHookConsumers,
  type GlobalHookConsumerRegistrationOutcome
} from './global-hook-ownership'

const ENABLE_ENV = 'ORCA_ENABLE_GLOBAL_HOOK_INSTALL'
const STATE_DIR_NAME = 'opencode-global-hook'

export function isGlobalHookInstallEnabled(): boolean {
  return process.env[ENABLE_ENV] === '1'
}

export function globalHookPathsFor(homeDir: string, userDataDir: string) {
  return {
    pluginsDir: join(homeDir, '.config', 'opencode', 'plugins'),
    stateDir: join(userDataDir, STATE_DIR_NAME)
  }
}

/**
 * Provision the process-local identity env for a direct Orca→OpenCode child PTY:
 * a fresh single-purpose token plus the state dir, with every other ORCA_* var
 * stripped (design §6). Nested shells never inherit the identity — the PTY env
 * assembler deletes ORCA_HOOK_STATE_DIR/ORCA_HOOK_IDENTITY_TOKEN for non-direct
 * children (AGENT_HOOK_RUNTIME_ENV_KEYS). Throws on malformed provisioning so a
 * bad identity can never ship as partial Orca state.
 */
export function provisionGlobalHookChildEnv(args: {
  readonly parentEnv: Record<string, string | undefined>
  readonly homeDir: string
  readonly userDataDir: string
}): { readonly identityToken: string; readonly env: Record<string, string> } {
  const { stateDir } = globalHookPathsFor(args.homeDir, args.userDataDir)
  const identityToken = createGlobalHookIdentityToken()
  return {
    identityToken,
    env: buildGlobalHookChildEnv(args.parentEnv, { stateDir, identityToken })
  }
}

/**
 * Task 18 lifetime-ownership seam for the PTY spawn path: mint the identity env
 * AND register the consumer's ownership record (pid + start time + boot id +
 * token hash + generation) BEFORE the PTY handoff, under the installer lock.
 * The env is still returned when registration refuses (corrupt registry /
 * unreadable identity) — the refusal is reported for logging, and the §6 checked
 * uninstall remains conservative either way.
 */
export async function provisionGlobalHookConsumerEnv(args: {
  readonly parentEnv: Record<string, string | undefined>
  readonly homeDir: string
  readonly userDataDir: string
  readonly consumerId: string
  readonly pid: number
}): Promise<{
  readonly identityToken: string
  readonly env: Record<string, string>
  readonly registration: GlobalHookConsumerRegistrationOutcome
}> {
  const { identityToken, env } = provisionGlobalHookChildEnv(args)
  const paths = globalHookPathsFor(args.homeDir, args.userDataDir)
  const registration = await registerGlobalHookConsumer({
    paths,
    consumer: {
      consumerId: args.consumerId,
      pid: args.pid,
      identityToken
    }
  })
  return { identityToken, env, registration }
}

export async function maybeInstallGlobalOpenCodeHook(args: {
  readonly homeDir: string
  readonly userDataDir: string
  readonly enabled: boolean
}): Promise<void> {
  if (!args.enabled) {
    return
  }
  const paths = globalHookPathsFor(args.homeDir, args.userDataDir)
  try {
    const outcome = await installGlobalOpenCodeHook({ paths })
    console.log(`[opencode-global-hook] install outcome: ${outcome.status}`, outcome)
  } catch (error) {
    // Why: never block or fail startup on the hook; log and continue.
  }
  try {
    // Design §6: stale-record GC also runs on Orca start.
    const reconciled = await reconcileGlobalHookConsumers({
      paths,
      reader: createProcfsProcessIdentityReader()
    })
    if (reconciled.status !== 'ok') {
      console.warn(`[opencode-global-hook] consumer registry unreadable: ${reconciled.status}`)
    } else if (reconciled.pruned.length > 0) {
      console.log(`[opencode-global-hook] pruned ${reconciled.pruned.length} stale consumer record(s)`)
    }
  } catch (error) {
    console.warn('[opencode-global-hook] consumer reconcile failed:', error)
  }
  await logGlobalHookDigestCheck(paths.pluginsDir)
}

export async function logGlobalHookDigestCheck(pluginsDir: string): Promise<void> {
  let status: GlobalHookVerifyStatus
  try {
    status = await verifyGlobalOpenCodeHook({ pluginsDir })
  } catch (error) {
    console.warn('[opencode-global-hook] digest self-check errored:', error)
    return
  }
  if (status === 'ok') {
    return
  }
  // v1: log-only (design §6). Any non-ok state is surfaced, never auto-repaired here.
  console.warn(`[opencode-global-hook] installed plugin self-check: ${status}`)
}
