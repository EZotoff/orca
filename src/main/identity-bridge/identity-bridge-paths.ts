// Path resolution for the identity bridge's Orca-owned state (Task 13).
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'

export const IDENTITY_BRIDGE_FILE_NAME = 'identity-bridge.json'

/** Bridge state lives beside the other userData files; ORCA_IDENTITY_BRIDGE_PATH overrides for tests. */
export function defaultIdentityBridgePath(): string {
  const override = process.env['ORCA_IDENTITY_BRIDGE_PATH']
  if (override !== undefined && override !== '') {
    return override
  }
  return join(getAppEnvironment().getPath('userData'), IDENTITY_BRIDGE_FILE_NAME)
}
