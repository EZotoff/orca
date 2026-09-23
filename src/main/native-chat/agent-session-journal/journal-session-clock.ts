// Which journal rows date the session.
//
// `lastActivityAt` becomes the status summary's `updatedAt`, which the status row uses as its
// completion stamp and acknowledgement clock. Subagents write into the same journal and keep
// going after the session's own agent settles, so counting their rows re-dates an idle
// session and marks it unread again.

import { isRootAgentJournalItem } from '../../../shared/agent-session-journal-producer'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../../shared/agent-session-journal-types'
import { isSubagentGroupBlock } from '../../../shared/native-chat-types'
import type { JournalRow } from './journal-row-schema'

type JournalItemLookup = {
  items: ReadonlyMap<string, AgentJournalRenderItem>
  aliases: ReadonlyMap<string, string>
}

/** Whether a row is the session's own agent at work. Not a subagent's row (its linkage names
 *  it), and not a subagent roster: the session's row, but revised on every child transition.
 *  A roster's first write sits beside the spawn call, which dates the session anyway. */
export function journalRowDatesSession(lookup: JournalItemLookup, row: JournalRow): boolean {
  if (row.kind === 'epoch' || !isRootAgentJournalItem(row)) {
    return false
  }
  if (row.kind === 'item') {
    return !isSubagentRoster(row.body)
  }
  if (row.kind === 'tombstone') {
    return !isSubagentRoster(currentBody(lookup, row.itemId))
  }
  if (row.kind === 'lifecycle-batch') {
    return row.mutations.some(
      (mutation) =>
        !isSubagentRoster(
          mutation.kind === 'item' ? mutation.body : currentBody(lookup, mutation.itemId)
        )
    )
  }
  return true
}

function isSubagentRoster(body: AgentJournalItemBody | undefined): boolean {
  return body?.kind === 'message' && body.blocks.some(isSubagentGroupBlock)
}

/** Read before the reducer applies the row: a tombstone names what it is about to remove. */
function currentBody(lookup: JournalItemLookup, itemId: string): AgentJournalItemBody | undefined {
  return lookup.items.get(lookup.aliases.get(itemId) ?? itemId)?.body
}
