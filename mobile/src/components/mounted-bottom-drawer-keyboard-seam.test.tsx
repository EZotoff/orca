import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SoftKeyboardState } from '../platform/keyboard-occlusion'

type Harness = {
  keyboard: SoftKeyboardState
  timings: { to: number; duration: number | undefined }[]
  /** Every shared-value write: a seed lands here directly, without a timing. */
  writes: number[]
}

const harness = vi.hoisted((): Harness => ({
  keyboard: { height: 0, visible: false, duration: 0 },
  timings: [],
  writes: []
}))

vi.mock('../platform/keyboard-occlusion', () => ({ useSoftKeyboard: () => harness.keyboard }))
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('react-native', () => ({
  Keyboard: { dismiss: () => {} },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 900 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {}
  for (const method of [
    'activeOffsetY',
    'simultaneousWithExternalGesture',
    'onBegin',
    'onUpdate',
    'onEnd'
  ]) {
    chain[method] = () => chain
  }
  return {
    Gesture: { Pan: () => chain, Native: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
  useSharedValue: (initial: number) => {
    let value = initial
    return {
      get value() {
        return value
      },
      set value(next: number) {
        value = next
        harness.writes.push(next)
      }
    }
  },
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  withSpring: (to: number) => to,
  withTiming: (to: number, config?: { duration?: number }) => {
    harness.timings.push({ to, duration: config?.duration })
    return to
  },
  runOnJS: (fn: () => void) => fn,
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' }
}))

import { MountedBottomDrawer } from './mounted-bottom-drawer'

function sheet(fillAvailable: boolean) {
  return (
    <MountedBottomDrawer
      visible
      fillAvailable={fillAvailable}
      onClose={() => {}}
      onHidden={() => {}}
    >
      {null}
    </MountedBottomDrawer>
  )
}

function render(fillAvailable: boolean): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(sheet(fillAvailable))
  })
  return renderer
}

function moveKeyboard(
  renderer: ReactTestRenderer,
  fillAvailable: boolean,
  next: SoftKeyboardState
): void {
  harness.keyboard = next
  act(() => renderer.update(sheet(fillAvailable)))
}

function marginBottom(renderer: ReactTestRenderer): unknown {
  const node = renderer.root.find((candidate) => candidate.props.testID === 'bottom-drawer-sheet')
  const style: unknown[] = [node.props.style].flat(Infinity)
  return Object.assign({}, ...style.filter((entry) => typeof entry === 'object' && entry !== null))
    .marginBottom
}

describe('the drawer riding the keyboard seam', () => {
  afterEach(() => {
    harness.keyboard = { height: 0, visible: false, duration: 0 }
    harness.timings.length = 0
    harness.writes.length = 0
  })

  it('docks a fill sheet on a keyboard already up when it opens', () => {
    harness.keyboard = { height: 300, visible: true, duration: 0 }
    const renderer = render(true)
    expect(marginBottom(renderer)).toBe(300)
    act(() => renderer.unmount())
  })

  it('does not seed a content-sized sheet from a keyboard already up', () => {
    harness.keyboard = { height: 300, visible: true, duration: 0 }
    const renderer = render(false)
    expect(harness.writes).not.toContain(300)
    // It still rides the keyboard's next move.
    moveKeyboard(renderer, false, { height: 310, visible: true, duration: 0 })
    expect(harness.timings).toContainEqual({ to: 310, duration: 250 })
    act(() => renderer.unmount())
  })

  it('lifts with the event duration and drops back when the keyboard hides', () => {
    const renderer = render(true)
    moveKeyboard(renderer, true, { height: 280, visible: true, duration: 120 })
    expect(marginBottom(renderer)).toBe(280)
    expect(harness.timings).toContainEqual({ to: 280, duration: 120 })
    moveKeyboard(renderer, true, { height: 0, visible: false, duration: 0 })
    expect(marginBottom(renderer)).toBe(0)
    // An event without a duration still animates, as it did when the drawer listened itself.
    expect(harness.timings).toContainEqual({ to: 0, duration: 250 })
    act(() => renderer.unmount())
  })
})
