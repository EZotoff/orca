import { describe, expect, it } from 'vitest'
import { deriveRailGitIndicator } from './overview-rail-git'

describe('deriveRailGitIndicator', () => {
  it('derives the branch label from a full ref', () => {
    expect(deriveRailGitIndicator({ branch: 'refs/heads/main', head: 'abc1234', dirtyCount: 0 })).toEqual({
      label: 'main',
      dirty: false,
      dirtyCount: 0
    })
  })

  it('truncates long branch names for the narrow rail column', () => {
    const indicator = deriveRailGitIndicator({ branch: 'refs/heads/feature/very-long-name', dirtyCount: 0 })
    expect(indicator?.label.length).toBeLessThanOrEqual(8)
    expect(indicator?.label.endsWith('…')).toBe(true)
  })

  it('marks dirty only when the worktree has status entries', () => {
    expect(deriveRailGitIndicator({ branch: 'refs/heads/main', dirtyCount: 3 })).toEqual({
      label: 'main',
      dirty: true,
      dirtyCount: 3
    })
    expect(deriveRailGitIndicator({ branch: 'refs/heads/main', dirtyCount: 0 })?.dirty).toBe(false)
  })

  it('falls back to the short head label for detached worktrees', () => {
    const indicator = deriveRailGitIndicator({ branch: null, head: 'deadbee', dirtyCount: 0 })
    expect(indicator?.label).toBe('deadbee')
  })

  it('returns null when no git identity exists', () => {
    expect(deriveRailGitIndicator({ branch: null, head: null, dirtyCount: 5 })).toBeNull()
  })
})
