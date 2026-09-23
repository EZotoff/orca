// Why: Task 16 — ownership marker format for the globally installed OpenCode plugin.
// The marker is a fixed comment header prepended by the installer. The digest covers
// ONLY the plugin body (bytes after the body-end line), because a file cannot contain
// a hash of its own bytes. Marker digest vs body digest therefore detects tampering;
// marker digest vs the current build's expected digest detects version drift.

import { createHash } from 'node:crypto'

const OWNER_LINE = '// ORCA-OWNED-PLUGIN'
const BODY_END_LINE = '// orca:body-end'

export type GlobalHookMarker = {
  readonly installerVersion: number
  readonly installedAt: string
  readonly digest: string
}

export type ParsedMarkedContent = {
  readonly marker: GlobalHookMarker
  readonly body: string
}

export function hashGlobalHookBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export function buildMarkedGlobalHookContent(
  body: string,
  marker: {
    readonly installerVersion: number
    readonly installedAt: string
    readonly digest?: string
  }
): string {
  const digest = marker.digest ?? hashGlobalHookBody(body)
  return [
    OWNER_LINE,
    '// orca:owner=orca',
    `// orca:installer-version=${marker.installerVersion}`,
    `// orca:installed-at=${marker.installedAt}`,
    `// orca:body-sha256=${digest}`,
    BODY_END_LINE,
    body
  ].join('\n')
}

export function parseMarkedGlobalHookContent(content: string): ParsedMarkedContent | null {
  const lines = content.split('\n')
  if (lines.length < 7 || lines[0] !== OWNER_LINE) {
    return null
  }
  if (lines[1] !== '// orca:owner=orca') {
    return null
  }
  let installerVersion = 0
  let installedAt = ''
  let digest = ''
  let bodyStart = -1
  for (let i = 2; i < Math.min(lines.length, 12); i++) {
    const line = lines[i]
    if (line === BODY_END_LINE) {
      bodyStart = i + 1
      break
    }
    if (line.startsWith('// orca:installer-version=')) {
      const parsed = Number.parseInt(line.slice('// orca:installer-version='.length), 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null
      }
      installerVersion = parsed
    } else if (line.startsWith('// orca:installed-at=')) {
      installedAt = line.slice('// orca:installed-at='.length)
    } else if (line.startsWith('// orca:body-sha256=')) {
      digest = line.slice('// orca:body-sha256='.length)
    }
  }
  if (bodyStart < 0 || installerVersion <= 0 || installedAt === '') {
    return null
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    return null
  }
  return { marker: { installerVersion, installedAt, digest }, body: lines.slice(bodyStart).join('\n') }
}

/**
 * Recompute the body digest of an installed file. Returns null when the content does
 * not carry a parseable Orca marker (a foreign file).
 */
export function installedGlobalHookBodyDigest(content: string): string | null {
  const parsed = parseMarkedGlobalHookContent(content)
  return parsed ? hashGlobalHookBody(parsed.body) : null
}

export function isGlobalHookTempPath(fileName: string): boolean {
  // durableWriteTempPath shape (<final>.<pid>.<ts>.<rand>.tmp) — must never match
  // OpenCode's auto-discovery glob `{plugin,plugins}/*.{ts,js}`.
  return fileName.endsWith('.tmp')
}
