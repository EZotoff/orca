// Fetches the host's conversation outline for the message rail, only while the
// pane is visible and older history is actually unloaded. A session whose whole
// journal is loaded never asks.
//
// One fetch per stale edge, never per streamed batch: the request key is the
// epoch while the outline is stale, so a live stream that keeps trimming the
// window does not restart it, and a failed read is not retried until the view
// stops being stale or the pane is shown again. Nothing here can block the
// transcript — without an outline the rail maps the loaded messages.

import { useEffect, useState } from 'react'
import type { AgentSessionConversationOutline } from '../../../../shared/agent-session-conversation-outline'
import type { StructuredAgentSessionState } from '../../../../shared/structured-agent-session-reducer'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { readStructuredAgentSessionConversationOutline } from '@/runtime/structured-agent-session-client'
import type { NativeChatRailOutlineEntry } from './native-chat-message-rail-items'
import { selectStructuredRailOutline } from './structured-agent-session-rail-outline'

export function useStructuredAgentSessionRailOutline({
  sessionId,
  target,
  state,
  enabled
}: {
  sessionId: string
  target: RuntimeClientTarget
  state: Pick<StructuredAgentSessionState, 'epoch' | 'items' | 'hasOlder'>
  enabled: boolean
}): readonly NativeChatRailOutlineEntry[] | null {
  const [outline, setOutline] = useState<AgentSessionConversationOutline | null>(null)
  const current = outline?.sessionId === sessionId ? outline : null
  const view = selectStructuredRailOutline(current, {
    epoch: state.epoch,
    oldestLoadedSequence: state.items[0]?.sequence ?? null,
    hasOlder: state.hasOlder
  })
  const requestKey = enabled && view.kind === 'stale' ? state.epoch : null

  useEffect(() => {
    if (requestKey === null) {
      return
    }
    let cancelled = false
    void readStructuredAgentSessionConversationOutline(target, sessionId).then((result) => {
      if (!cancelled && result) {
        setOutline(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [requestKey, sessionId, target])

  return view.kind === 'fresh' ? view.entries : null
}
