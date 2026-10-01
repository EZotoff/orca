import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as osModule from 'node:os'
import { join } from 'node:path'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

const userDataDir = mkdtempSync(join(tmpdir(), 'orca-omo-test-userdata-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osModule>()
  return {
    ...actual,
    homedir: () => actual.homedir()
  }
})

import { PiTitlebarExtensionService } from './titlebar-extension-service'

const MARKER = '@orca-managed-pi-extension'

describe('PiTitlebarExtensionService omo kind', () => {
  beforeEach(() => {
    installFakeAppEnvironment({
      getPath: (name) => (name === 'userData' ? userDataDir : '')
    })
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('installs managed extensions and sets only ORCA_OMO_SOURCE_AGENT_DIR', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'orca-omo-agent-'))
    try {
      const env = new PiTitlebarExtensionService().buildPtyEnv('pty-1', agentDir, 'omo')
      const statusPath = join(agentDir, 'extensions', 'orca-agent-status.ts')
      expect(existsSync(statusPath)).toBe(true)
      expect(readFileSync(statusPath, 'utf8')).toContain(MARKER)
      expect(env.ORCA_OMO_SOURCE_AGENT_DIR).toBe(agentDir)
      // Why: oa5-style wrappers export their own OMO_CODING_AGENT_DIR; Orca
      // must never inject any omo/pi primary dir into the child env (probe 96).
      expect(env.OMO_CODING_AGENT_DIR).toBeUndefined()
      expect(env.SENPI_CODING_AGENT_DIR).toBeUndefined()
      expect(env.PI_CODING_AGENT_DIR).toBeUndefined()
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  it('never touches user-owned files in the agent dir (pilot sandbox shape)', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'orca-omo-agent-'))
    try {
      mkdirSync(join(agentDir, 'extensions'), { recursive: true })
      const userExtension = join(agentDir, 'extensions', 'diff.js')
      writeFileSync(userExtension, '// user-owned pilot extension\n')
      // Why: a user-owned orca-agent-status.ts (no marker) must be skipped, not overwritten.
      const userStatus = join(agentDir, 'extensions', 'orca-agent-status.ts')
      writeFileSync(userStatus, '// user wrote this first\n')

      const env = new PiTitlebarExtensionService().buildPtyEnv('pty-2', agentDir, 'omo')

      expect(readFileSync(userExtension, 'utf8')).toBe('// user-owned pilot extension\n')
      expect(readFileSync(userStatus, 'utf8')).toBe('// user wrote this first\n')
      expect(env.ORCA_OMO_SOURCE_AGENT_DIR).toBe(agentDir)
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })

  it('overwrites a marker-owned status extension from a previous Orca run', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'orca-omo-agent-'))
    try {
      mkdirSync(join(agentDir, 'extensions'), { recursive: true })
      const statusPath = join(agentDir, 'extensions', 'orca-agent-status.ts')
      writeFileSync(statusPath, `// ${MARKER}\n// stale orca write\n`)

      new PiTitlebarExtensionService().buildPtyEnv('pty-3', agentDir, 'omo')

      expect(readFileSync(statusPath, 'utf8')).not.toContain('stale orca write')
      expect(readFileSync(statusPath, 'utf8')).toContain(MARKER)
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }
  })
})
