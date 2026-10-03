import { translate } from '@/i18n/i18n'
import type { AgentCatalogEntry } from './agent-catalog'

// Why: a separate module — the main agent-catalog file sits at the oxlint
// max-lines(400) ceiling, so the omo entry cannot be inlined there.
export const OMO_CATALOG_ENTRY: AgentCatalogEntry = {
  id: 'omo',
  label: translate('auto.lib.agent.catalog.7c1f4a92bd', 'omo (OMO Native)'),
  cmd: 'omo',
  searchAliases: ['oa5', 'omo-ai', 'senpi', 'oh-my-openagent'],
  // Why: no iconUrl/faviconDomain — omo falls through to the neutral letter glyph.
  homepageUrl: 'https://www.npmjs.com/package/omo-ai'
}
