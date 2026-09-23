// React subscription hook for the Supervisor relay (orca-transition plan
// Task 12). Pulls the snapshot once on mount, then follows main-process
// pushes. Read-only ambient chrome: the payload is already redacted in main.
import { useEffect, useState } from 'react'
import type { SupervisorRelayPayload } from '../../../../shared/supervisor-relay-types'

export function useSupervisorRelay(): SupervisorRelayPayload | undefined {
  const [payload, setPayload] = useState<SupervisorRelayPayload | undefined>(undefined)

  useEffect(() => {
    let disposed = false
    const unsubscribe = window.api.supervisorRelay.onUpdate((next) => {
      if (!disposed) setPayload(next)
    })
    void window.api.supervisorRelay.getSnapshot().then((snapshot) => {
      if (!disposed) setPayload(snapshot)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return payload
}
