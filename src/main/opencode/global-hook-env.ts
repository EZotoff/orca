// Why: Task 17 (orca-transition design §6 "Process isolation") — the documented
// Orca identity env contract for the globally discovered OpenCode plugin, plus the
// env allow-list used when Orca spawns a child OpenCode PTY. The child env carries
// ONLY the two documented identity vars (state dir + single-purpose identity token);
// every other ORCA_* var is stripped so nested shells / non-Orca launches stay inert.
// The identity token is random per launch, revocable via a hash list in the state
// dir, and is NOT an API key — it proves only "Orca spawned this process".
//
// Consumption: Task 18 (lifetime ownership) wires buildGlobalHookChildEnv into the
// actual PTY spawn; this module defines the semantics both sides must honor.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  durableWriteTempPath,
  renameDurable,
  writeTempFileDurable
} from '../durable-file-write'
import {
  GLOBAL_HOOK_IDENTITY_TOKEN_ENV,
  GLOBAL_HOOK_STATE_DIR_ENV
} from './global-hook-plugin-source'

export { GLOBAL_HOOK_IDENTITY_TOKEN_ENV, GLOBAL_HOOK_STATE_DIR_ENV }

/** The ONLY Orca vars a child OpenCode process may see (design §6). */
export const GLOBAL_HOOK_ENV_ALLOWLIST: readonly string[] = [
  GLOBAL_HOOK_STATE_DIR_ENV,
  GLOBAL_HOOK_IDENTITY_TOKEN_ENV
] as const

const IDENTITY_TOKEN_PREFIX = 'orca1.'
const IDENTITY_TOKEN_MIN_RANDOM_CHARS = 32
const IDENTITY_TOKEN_MAX_LENGTH = 512
const REVOKED_TOKENS_FILE = 'revoked-tokens.json'

export function isValidGlobalHookIdentityToken(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  if (!value.startsWith(IDENTITY_TOKEN_PREFIX)) {
    return false
  }
  const random = value.slice(IDENTITY_TOKEN_PREFIX.length)
  return (
    random.length >= IDENTITY_TOKEN_MIN_RANDOM_CHARS &&
    random.length <= IDENTITY_TOKEN_MAX_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(random)
  )
}

export function createGlobalHookIdentityToken(): string {
  // Why: 32 random bytes base64url ≈ 43 chars — unguessable, single-purpose, revocable.
  return IDENTITY_TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export function hashGlobalHookIdentityToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Remove every ORCA_* var except the documented allow-list. Applied to the env
 * handed to the direct Orca→OpenCode child PTY: internal Orca vars (hook
 * endpoints, transport, feature gates) must never leak into a process the global
 * plugin runs in. Nested shells are handled by AGENT_HOOK_RUNTIME_ENV_KEYS,
 * which deletes the identity vars too.
 */
export function stripOrcaHookEnv<T extends Record<string, string | undefined>>(
  env: T
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('ORCA_') && !GLOBAL_HOOK_ENV_ALLOWLIST.includes(key)) {
      continue
    }
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

/**
 * The env for an Orca-spawned OpenCode child: the parent env with all
 * non-documented ORCA_* vars stripped, plus exactly the two identity vars.
 * Rejects malformed provisioning (state dir / token) so a bad identity can
 * never ship to a child as "partial" Orca state.
 */
export function buildGlobalHookChildEnv(
  parentEnv: Record<string, string | undefined>,
  identity: { readonly stateDir: string; readonly identityToken: string }
): Record<string, string> {
  if (!identity.stateDir.startsWith('/') || identity.stateDir.includes('..')) {
    throw new Error('invalid global-hook state dir provisioning')
  }
  if (!isValidGlobalHookIdentityToken(identity.identityToken)) {
    throw new Error('invalid global-hook identity token provisioning')
  }
  const env = stripOrcaHookEnv(parentEnv)
  env[GLOBAL_HOOK_STATE_DIR_ENV] = identity.stateDir
  env[GLOBAL_HOOK_IDENTITY_TOKEN_ENV] = identity.identityToken
  return env
}

/**
 * Revoke an identity token by appending its SHA256 to the state dir's revocation
 * list (atomic durable write). The plugin's guard reads this list before
 * registering, so a revoked token deactivates the plugin on the next process.
 */
export async function revokeGlobalHookIdentityToken(args: {
  readonly stateDir: string
  readonly token: string
}): Promise<void> {
  const listPath = join(args.stateDir, REVOKED_TOKENS_FILE)
  let revoked: string[] = []
  try {
    revoked = JSON.parse(await readFile(listPath, 'utf8')) as string[]
  } catch {
    revoked = []
  }
  const digest = hashGlobalHookIdentityToken(args.token)
  if (Array.isArray(revoked) && revoked.includes(digest)) {
    return
  }
  const next = Array.isArray(revoked) ? [...revoked, digest] : [digest]
  await mkdir(args.stateDir, { recursive: true, mode: 0o700 })
  const tmpPath = durableWriteTempPath(listPath)
  await writeTempFileDurable(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  await renameDurable(tmpPath, listPath)
}

export function revokedGlobalHookTokensFileName(): string {
  return REVOKED_TOKENS_FILE
}
