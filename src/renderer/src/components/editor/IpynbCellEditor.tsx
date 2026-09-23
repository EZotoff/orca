import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { Components } from 'react-markdown'
import { monaco } from '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontStack } from '@/lib/editor-font-zoom'
import { useAppStore } from '@/store'
import { installEditorSaveShortcut, installMonacoEditorFindShortcut } from './editor-shortcuts'
import {
  IPYNB_CODE_CELL_PREVIEW_MAX_LINES,
  getIpynbCodeCellPreviewLines
} from './ipynb-code-cell-lines'
import type { IpynbCell } from './ipynb-parse'
import { MarkdownPreviewBody } from './MarkdownPreviewBody'
import { useMonacoColorizedLines } from './MonacoCodeExcerpt'
import { useDocumentDarkTheme } from './use-document-dark-theme'

const NO_MARKDOWN_COMPONENTS: Components = {}
// Box metrics the preview and the live editor share, so activating a cell never shifts it.
const CODE_LAYOUT = { lineHeight: 20, paddingY: 4, paddingX: 12 } as const
// Fixed rows keep colorized blank lines one line tall; preflight gives <code> its own font.
const CODE_ROW_STYLE = {
  height: CODE_LAYOUT.lineHeight,
  paddingInline: CODE_LAYOUT.paddingX,
  fontFamily: 'inherit'
} as const

export function IpynbMarkdownCell({ source }: { source: string }): React.JSX.Element {
  const isDark = useDocumentDarkTheme()
  return (
    <div className={isDark ? 'markdown-dark' : 'markdown-light'}>
      <div className="markdown-body">
        <MarkdownPreviewBody content={source} components={NO_MARKDOWN_COMPONENTS} />
      </div>
    </div>
  )
}

type IpynbCellSourceProps = {
  cell: IpynbCell
  source: string
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
  onChange: (source: string) => void
  onSaveRequest: () => Promise<void>
}

type SourcePosition = { lineNumber: number; column: number }

/** Model position under a press on the preview; its rows mirror the model's lines one-to-one. */
export function previewPositionAtPoint(x: number, y: number): SourcePosition | null {
  const caret = document.caretPositionFromPoint(x, y)
  const node = caret?.offsetNode
  const row = (node instanceof Element ? node : node?.parentElement)?.closest('code')
  if (!caret || !node || !row?.parentElement) {
    return null
  }
  const prefix = document.createRange()
  prefix.setStart(row, 0)
  prefix.setEnd(node, caret.offset)
  return {
    lineNumber: Array.from(row.parentElement.children).indexOf(row) + 1,
    column: prefix.toString().length + 1
  }
}

/** Rendered cell source (markdown document or colorized code) that swaps to Monaco while active. */
export function IpynbCellSource(props: IpynbCellSourceProps): React.JSX.Element {
  const { cell, source, active, onActivate } = props
  // Where Monaco opens its caret; null opens at the end (keyboard or markdown activation).
  const [openAt, setOpenAt] = useState<SourcePosition | null>(null)
  const activate = (position: SourcePosition | null): void => {
    setOpenAt(position)
    onActivate()
  }
  const activateOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      activate(null)
    }
  }

  if (!active && cell.kind === 'markdown') {
    return (
      <div
        role="button"
        tabIndex={0}
        className="min-h-8 cursor-text rounded-md px-3 py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onDoubleClick={() => activate(null)}
        onKeyDown={activateOnEnter}
      >
        <IpynbMarkdownCell source={source} />
      </div>
    )
  }

  return (
    <div className="ipynb-code-surface overflow-hidden rounded-md border border-border bg-muted/60 focus-within:border-ring">
      {active ? (
        <IpynbSourceEditor {...props} openAt={openAt} />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="cursor-text outline-none"
          // Why: activating on press (not click) keeps the target stable while the previously active cell collapses.
          onMouseDown={(event) => {
            if (event.button === 0) {
              event.preventDefault()
              activate(previewPositionAtPoint(event.clientX, event.clientY))
            }
          }}
          onKeyDown={activateOnEnter}
        >
          <IpynbCodePreview source={source} language={cell.language} />
        </div>
      )}
    </div>
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function IpynbCodePreview({
  source,
  language
}: {
  source: string
  language: string
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const lines = useMemo(() => getIpynbCodeCellPreviewLines(source), [source])
  const htmlLines = useMonacoColorizedLines(lines, language)
  return (
    <div
      className="overflow-x-auto text-foreground"
      style={{
        fontFamily: resolveEditorFontStack(settings),
        fontSize: computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel),
        lineHeight: `${CODE_LAYOUT.lineHeight}px`,
        paddingBlock: CODE_LAYOUT.paddingY,
        // Monaco renders code without the app's body tracking.
        letterSpacing: 0
      }}
    >
      {lines.map((line, index) => (
        <code
          key={index}
          className="block whitespace-pre"
          style={CODE_ROW_STYLE}
          // Plain text shows until Monaco's async colorizer fills in token HTML.
          dangerouslySetInnerHTML={{ __html: htmlLines[index] || escapeHtml(line) }}
        />
      ))}
    </div>
  )
}

function IpynbSourceEditor({
  cell,
  source,
  openAt,
  onDeactivate,
  onChange,
  onSaveRequest
}: IpynbCellSourceProps & { openAt: SourcePosition | null }): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const isDark = useDocumentDarkTheme()
  const onDeactivateRef = useRef(onDeactivate)
  const onSaveRequestRef = useRef(onSaveRequest)
  useLayoutEffect(() => {
    onDeactivateRef.current = onDeactivate
    onSaveRequestRef.current = onSaveRequest
  }, [onDeactivate, onSaveRequest])
  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const { lineHeight, paddingX, paddingY } = CODE_LAYOUT
  const maxHeight = IPYNB_CODE_CELL_PREVIEW_MAX_LINES * lineHeight
  // Seeds the first frame only; Monaco reports the real content height after mount.
  const [contentHeight, setContentHeight] = useState(
    () => getIpynbCodeCellPreviewLines(source).length * lineHeight + 2 * paddingY
  )
  const handleMount: OnMount = useCallback(
    (editorInstance, monacoInstance) => {
      // Why: place the caret before focusing; focus highlights occurrences of the word under it.
      const endPosition = editorInstance.getModel()?.getFullModelRange().getEndPosition()
      const position = openAt ?? endPosition
      if (position) {
        editorInstance.setPosition(position)
      }
      editorInstance.focus()
      const cleanupSaveShortcut = installEditorSaveShortcut(
        editorInstance.getContainerDomNode(),
        () => {
          void onSaveRequestRef.current()
        }
      )
      const cleanupFindShortcut = installMonacoEditorFindShortcut(editorInstance)
      const blurSub = editorInstance.onDidBlurEditorWidget(() => {
        onDeactivateRef.current()
      })
      const sizeSub = editorInstance.onDidContentSizeChange((event) => {
        setContentHeight(event.contentHeight)
      })
      setContentHeight(editorInstance.getContentHeight())
      editorInstance.onDidDispose(() => {
        cleanupSaveShortcut()
        cleanupFindShortcut()
        blurSub.dispose()
        sizeSub.dispose()
      })
      editorInstance.addCommand(monacoInstance.KeyCode.Escape, () => {
        onDeactivateRef.current()
      })
    },
    [openAt]
  )

  useEffect(() => {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  }, [isDark])

  return (
    <Editor
      height={Math.min(contentHeight, maxHeight)}
      language={cell.language}
      theme={isDark ? 'vs-dark' : 'vs'}
      value={source}
      onMount={handleMount}
      onChange={(value) => onChange(value ?? '')}
      options={{
        automaticLayout: true,
        fontFamily: resolveEditorFontStack(settings),
        fontSize,
        // Why: same box as the excerpt it replaces. No gutter, so the decorations lane is the inset.
        lineHeight,
        padding: { top: paddingY, bottom: paddingY },
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: paddingX,
        minimap: { enabled: false },
        overviewRulerLanes: 0,
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        // Why: an auto-sized cell must let wheel events scroll the notebook, not trap them.
        scrollbar: { alwaysConsumeMouseWheel: false },
        wordWrap: cell.kind === 'code' ? 'off' : 'on'
      }}
    />
  )
}
