import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  ORCA_OMO_AGENT_DIR_ENV,
  defaultOmoAgentDir,
  resolveOmoAgentDir,
  resolveOmoAgentDirOverride
} from './omo-agent-dir'

describe('resolveOmoAgentDir precedence', () => {
  it('defaults to ~/.omo/agent when nothing is set', () => {
    expect(resolveOmoAgentDir(() => undefined)).toBe(join(homedir(), '.omo', 'agent'))
  })

  it('prefers ORCA_OMO_AGENT_DIR over omo-native envs', () => {
    const env = {
      ORCA_OMO_AGENT_DIR: '/pilot/agent',
      OMO_CODING_AGENT_DIR: '/omo/agent',
      SENPI_CODING_AGENT_DIR: '/senpi/agent'
    }
    expect(resolveOmoAgentDir((key) => env[key])).toBe('/pilot/agent')
  })

  it('falls back OMO_CODING_AGENT_DIR → SENPI_CODING_AGENT_DIR', () => {
    expect(
      resolveOmoAgentDir((key) => (key === 'OMO_CODING_AGENT_DIR' ? '/omo/agent' : undefined))
    ).toBe('/omo/agent')
    expect(
      resolveOmoAgentDir((key) => (key === 'SENPI_CODING_AGENT_DIR' ? '/senpi/agent' : undefined))
    ).toBe('/senpi/agent')
  })

  it('never honors PI_CODING_AGENT_DIR', () => {
    expect(
      resolveOmoAgentDir((key) => (key === 'PI_CODING_AGENT_DIR' ? '/pi/agent' : undefined))
    ).toBe(defaultOmoAgentDir())
  })

  it('override variant leaves the default to the caller when unset', () => {
    expect(resolveOmoAgentDirOverride(() => undefined)).toBeUndefined()
    expect(
      resolveOmoAgentDirOverride((key) => (key === ORCA_OMO_AGENT_DIR_ENV ? '/x' : undefined))
    ).toBe('/x')
  })
})
