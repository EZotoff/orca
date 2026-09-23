import React, { useEffect, useMemo, useState } from 'react'
import { monaco } from '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontStack } from '@/lib/editor-font-zoom'
import { resolveDocumentTheme } from '@/lib/document-theme'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'

let pythonLanguageRegistrationPromise: Promise<void> | null = null

async function ensureColorizationLanguage(language: string): Promise<void> {
  if (language !== 'python') {
    return
  }
  pythonLanguageRegistrationPromise ??=
    import('monaco-editor/esm/vs/basic-languages/python/python.js').then(
      ({ conf, language: pythonTokens }) => {
        // Why: notebook excerpts colorize without mounting Monaco editors. Load
        // Python tokens only on demand so non-notebook users do not pay at startup.
        if (!monaco.languages.getLanguages().some((item) => item.id === 'python')) {
          monaco.languages.register({
            id: 'python',
            extensions: ['.py', '.pyw'],
            aliases: ['Python', 'py']
          })
        }
        monaco.languages.setLanguageConfiguration('python', conf)
        monaco.languages.setMonarchTokensProvider('python', pythonTokens)
      }
    )
  await pythonLanguageRegistrationPromise
}

/** Box metrics a live Monaco editor must reuse to swap in for an excerpt without shifting. */
export const CODE_EXCERPT_LAYOUT = { lineHeight: 20, paddingY: 4, paddingX: 12 } as const
// Why: preflight gives <code> its own mono stack; inherit so the editor font setting applies.
const CODE_STYLE = { paddingInline: CODE_EXCERPT_LAYOUT.paddingX, fontFamily: 'inherit' } as const

type MonacoCodeExcerptProps = {
  lines: string[]
  firstLineNumber: number
  highlightedStartLine: number
  highlightedEndLine: number
  language: string
  showLineNumbers?: boolean
}

export default function MonacoCodeExcerpt({
  lines,
  firstLineNumber,
  highlightedStartLine,
  highlightedEndLine,
  language,
  showLineNumbers = true
}: MonacoCodeExcerptProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const editorFontSize = computeEditorFontSize(
    settings?.terminalFontSize ?? 13,
    editorFontZoomLevel
  )
  const fontFamily = resolveEditorFontStack(settings)
  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')
  const code = useMemo(() => lines.join('\n'), [lines])
  const [htmlLines, setHtmlLines] = useState<string[]>(() => lines.map(() => ''))

  useEffect(() => {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }, [isDark])

  useEffect(() => {
    if (lines.length === 0) {
      setHtmlLines([])
      return
    }

    let cancelled = false
    // Why: notebook languages like Python are loaded lazily by Monaco. The
    // async colorizer waits for that tokenizer; colorizeModelLine can render
    // only default-token spans if called before the contribution finishes.
    void ensureColorizationLanguage(language)
      .catch(() => undefined)
      .then(() => monaco.editor.colorize(code, language, { tabSize: 2 }))
      .then((html) => {
        if (cancelled) {
          return
        }
        const nextLines = html.split('<br/>').slice(0, lines.length)
        setHtmlLines(nextLines)
      })

    return () => {
      cancelled = true
    }
  }, [code, language, lines])

  return (
    <div
      className="overflow-x-auto"
      style={{
        fontFamily,
        fontSize: editorFontSize,
        lineHeight: `${CODE_EXCERPT_LAYOUT.lineHeight}px`,
        paddingBlock: CODE_EXCERPT_LAYOUT.paddingY,
        letterSpacing: 0
      }}
    >
      {lines.map((codeLine, index) => {
        const lineNumber = firstLineNumber + index
        const isCommentedLine =
          lineNumber >= highlightedStartLine && lineNumber <= highlightedEndLine
        const html = htmlLines[index] || (codeLine ? undefined : '&nbsp;')
        return (
          <div
            key={lineNumber}
            className={cn('flex', isCommentedLine && 'bg-workspace-status-review/10')}
            // Why: colorized blank lines are empty spans; a fixed row keeps them one line tall.
            style={{ height: CODE_EXCERPT_LAYOUT.lineHeight }}
          >
            {showLineNumbers ? (
              <span className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted-foreground tabular-nums">
                {lineNumber}
              </span>
            ) : null}
            {html ? (
              <code
                className="min-w-max flex-1 whitespace-pre text-foreground"
                style={CODE_STYLE}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <code className="min-w-max flex-1 whitespace-pre text-foreground" style={CODE_STYLE}>
                {codeLine || ' '}
              </code>
            )}
          </div>
        )
      })}
    </div>
  )
}
