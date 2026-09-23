import { describe, it, expect } from 'vitest'
import {
  distanceFromBottom,
  isNearBottom,
  nextFollowingEnd,
  shouldShowJumpToLatest,
  NATIVE_CHAT_BOTTOM_THRESHOLD_PX,
  NATIVE_CHAT_FOLLOW_REARM_PX
} from './native-chat-autoscroll'

const atBottom = { scrollTop: 952, scrollHeight: 1000, clientHeight: 48 }
const scrolledUp = { scrollTop: 0, scrollHeight: 1000, clientHeight: 48 }
const noOverflow = { scrollTop: 0, scrollHeight: 48, clientHeight: 48 }

/** A view parked exactly `distance` px above the end of the same document. */
function parkedAbove(distance: number): {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
} {
  return { scrollTop: 952 - distance, scrollHeight: 1000, clientHeight: 48 }
}

describe('distanceFromBottom', () => {
  it('is zero at the exact bottom and never negative', () => {
    expect(distanceFromBottom(atBottom)).toBe(0)
    expect(distanceFromBottom({ scrollTop: 5000, scrollHeight: 1000, clientHeight: 48 })).toBe(0)
  })
})

describe('isNearBottom', () => {
  it('sticks within the threshold and detaches beyond it', () => {
    expect(isNearBottom(atBottom)).toBe(true)
    expect(
      isNearBottom({
        scrollTop: 952 - NATIVE_CHAT_BOTTOM_THRESHOLD_PX,
        scrollHeight: 1000,
        clientHeight: 48
      })
    ).toBe(true)
    expect(isNearBottom(scrolledUp)).toBe(false)
  })
})

describe('shouldShowJumpToLatest', () => {
  it('shows only when detached with content below', () => {
    expect(shouldShowJumpToLatest(false, scrolledUp)).toBe(true)
  })
  it('hides while stuck to bottom', () => {
    expect(shouldShowJumpToLatest(true, scrolledUp)).toBe(false)
  })
  it('hides when there is nothing to scroll', () => {
    expect(shouldShowJumpToLatest(false, noOverflow)).toBe(false)
  })
})

// The browser reports application writes as ordinary scroll events. Explicit
// marks distinguish their delayed echoes from reader movement after growth.
describe('nextFollowingEnd', () => {
  const following = { following: true, programmatic: false, geometry: parkedAbove(0) }
  const wellAway = parkedAbove(400)

  it('follows when the reader reaches the end', () => {
    expect(nextFollowingEnd(following)).toBe(true)
  })

  // The resume bug: history pages in and rows settle their measured heights, so
  // the end runs away from an offset the transcript itself pinned. That is not a
  // reader leaving, and treating it as one strands them mid-transcript.
  it('keeps following when a delayed application scroll arrives after growth', () => {
    expect(nextFollowingEnd({ ...following, programmatic: true, geometry: wellAway })).toBe(true)
  })

  it('treats an unmarked offset away from the end as the reader leaving', () => {
    expect(nextFollowingEnd({ ...following, geometry: wellAway })).toBe(false)
  })

  it.each([0, NATIVE_CHAT_FOLLOW_REARM_PX, 400])(
    'does not reattach a detached reader from an application write %i px from the end',
    (distance) => {
      expect(
        nextFollowingEnd({ following: false, programmatic: true, geometry: parkedAbove(distance) })
      ).toBe(false)
    }
  )

  // The jump affordance's wider band must not decide whether a reader follows.
  it('lets the reader park just inside the near-bottom band', () => {
    expect(NATIVE_CHAT_FOLLOW_REARM_PX).toBeLessThan(NATIVE_CHAT_BOTTOM_THRESHOLD_PX)
    const parked = parkedAbove(NATIVE_CHAT_BOTTOM_THRESHOLD_PX - 1)
    expect(nextFollowingEnd({ ...following, geometry: parked })).toBe(false)
    expect(isNearBottom(parked)).toBe(true)
    expect(shouldShowJumpToLatest(false, parked)).toBe(false)
  })

  it('re-arms at the band and not one pixel past it', () => {
    const detached = { following: false, programmatic: false }
    expect(
      nextFollowingEnd({ ...detached, geometry: parkedAbove(NATIVE_CHAT_FOLLOW_REARM_PX) })
    ).toBe(true)
    expect(
      nextFollowingEnd({ ...detached, geometry: parkedAbove(NATIVE_CHAT_FOLLOW_REARM_PX + 1) })
    ).toBe(false)
  })

  // Sub-pixel and zoom rounding put the true end a fraction short of exact.
  it('holds follow through rounding noise at the end', () => {
    expect(nextFollowingEnd({ ...following, geometry: parkedAbove(1.5) })).toBe(true)
  })
})
