import { PrioritySemaphore } from '../../../../shared/priority-semaphore'

// Why: a restore opens every visible pane at once, and each SSH open is a relay round trip.
export const MAX_CONCURRENT_STABLE_PANE_OPENS = 3

const stablePaneOpenLane = new PrioritySemaphore(MAX_CONCURRENT_STABLE_PANE_OPENS)

/** Runs one owner probe in the bounded lane; callers must not re-enter the lane from `open`. */
export async function runInStablePaneOpenLane<T>(open: () => Promise<T>): Promise<T> {
  const release = await stablePaneOpenLane.acquire(0)
  try {
    return await open()
  } finally {
    release()
  }
}
