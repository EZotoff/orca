import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * How much of the bottom of the layout viewport it covers, whether it is open at all, and how long
 * the event that last moved it says to animate for (0 when nothing animates).
 */
export type SoftKeyboardState = {
  readonly height: number
  readonly visible: boolean
  readonly duration: number
}

const CLOSED: SoftKeyboardState = { height: 0, visible: false, duration: 0 }

/** A keyboard already up at mount sends no show event, and autoFocus can raise one that early. */
function alreadyOpen(): SoftKeyboardState {
  const height = Keyboard.metrics()?.height ?? 0
  return height > 0 ? { height, visible: true, duration: 0 } : CLOSED
}

/**
 * What the software keyboard is doing, from the events the platform sends. iOS is told `will`,
 * Android `did`, which is the difference between animating with the keyboard and after it. Both
 * facts from one subscription, because the session screen wants each and two hooks would cost it
 * two listener pairs and two renders per keyboard event.
 *
 * The web sibling is where this earns its place under `platform/`: react-native-web's `Keyboard` is
 * a stub — `addListener` returns a subscription that never fires, `isVisible()` is always false and
 * `metrics` does not exist — so a screen inside the shell's page that asks it waits forever or
 * throws, and the software keyboard covers whatever sits at the bottom of the document. There the
 * two facts come apart, and neither is an event.
 */
export function useSoftKeyboard(): SoftKeyboardState {
  const [keyboard, setKeyboard] = useState<SoftKeyboardState>(alreadyOpen)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const onShow = Keyboard.addListener(showEvent, (event) => {
      // The keyboard's own height already describes the obscured area; the consumer adds whatever
      // clearance it wants above it. Open is the event, not the height: a keyboard that reports 0
      // is still one nobody wants the terminal re-fitted under.
      setKeyboard({
        height: Math.max(0, event.endCoordinates.height),
        visible: true,
        duration: event.duration
      })
    })
    const onHide = Keyboard.addListener(hideEvent, (event) =>
      setKeyboard({ ...CLOSED, duration: event.duration })
    )

    // Once more now the listeners are live: a keyboard that rose between render and here sent its
    // event to nobody.
    const open = alreadyOpen()
    if (open.visible) {
      setKeyboard((current) => (current.visible ? current : open))
    }

    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [])

  return keyboard
}

/** The occluded strip alone, for the callers that lift by it and never ask whether it is open. */
export function useKeyboardOcclusion(): number {
  return useSoftKeyboard().height
}

/**
 * The bottom padding a composer needs to clear the keyboard, which natively is none.
 *
 * `KeyboardAvoidingView` already moves the composer on a phone, so adding padding there would move
 * it twice. It is inert on the web for the same reason the `Keyboard` stub is — it is driven by
 * those events — so there the padding is the whole of the avoidance.
 *
 * A second name rather than a `Platform.OS` branch at the call site: this one subscribes to nothing
 * on a phone, so a composer that asks for it renders exactly as many times as it does today.
 */
export function useKeyboardAvoidingPadding(): number {
  return 0
}
