import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_VAULT_AGENT_SOURCES, isDiscoverableSessionFile } from './session-scanner-agent-sources'

describe('omo session source', () => {
  it('is registered with pi-shaped jsonl discovery', () => {
    const source = AI_VAULT_AGENT_SOURCES.omo
    expect(source).toBeDefined()
    expect(source.extensions).toEqual(['.jsonl'])
    const roots = source.rootDirs({}, [])
    expect(roots.length).toBeGreaterThan(0)
    expect(roots[0].replace(/\\/g, '/')).toContain('.omo')
  })

  it('accepts session jsonl under the omo root via the delete-validator rule', () => {
    const source = AI_VAULT_AGENT_SOURCES.omo!
    const root = source.rootDirs({}, [])[0]
    expect(isDiscoverableSessionFile(source, root, join(root, '20260901_abcd.jsonl'))).toBe(true)
    expect(isDiscoverableSessionFile(source, root, join(root, 'meta.json'))).toBe(false)
  })
})
