import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { Components } from 'react-markdown'
import { monaco } from '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { useAppStore } from '@/store'
import { installEditorSaveShortcut, installMonacoEditorFindShortcut } from './editor-shortcuts'
import {
  IPYNB_CODE_CELL_PREVIEW_MAX_LINES,
  getIpynbCodeCellPreviewLines
} from './ipynb-code-cell-lines'
import type { IpynbCell } from './ipynb-parse'
import { MarkdownPreviewBody } from './MarkdownPreviewBody'
import MonacoCodeExcerpt from './MonacoCodeExcerpt'
import { useDocumentDarkTheme } from './use-document-dark-theme'

const NO_MARKDOWN_COMPONENTS: Components = {}
// Matches MonacoCodeExcerpt's `leading-5 py-1`, so activating a cell does not shift the layout.
const SOURCE_LINE_HEIGHT_PX = 20
const SOURCE_VERTICAL_PADDING_PX = 4

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

/** Rendered cell source (markdown document or colorized code) that swaps to Monaco while active. */
export function IpynbCellSource(props: IpynbCellSourceProps): React.JSX.Element {
  const { cell, source, active, onActivate } = props
  const activateOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      onActivate()
    }
  }

  if (!active && cell.kind === 'markdown') {
    return (
      <div
        role="button"
        tabIndex={0}
        className="min-h-8 cursor-text rounded-md px-3 py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onDoubleClick={onActivate}
        onKeyDown={activateOnEnter}
      >
        <IpynbMarkdownCell source={source} />
      </div>
    )
  }

  return (
    <div className="ipynb-code-surface overflow-hidden rounded-md border border-border bg-muted/60 focus-within:border-ring">
      {active ? (
        <IpynbSourceEditor {...props} />
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="cursor-text outline-none"
          // Why: activating on press (not click) keeps the target stable while the previously active cell collapses.
          onMouseDown={(event) => {
            if (event.button === 0) {
              event.preventDefault()
              onActivate()
            }
          }}
          onKeyDown={activateOnEnter}
        >
          <MonacoCodeExcerpt
            lines={getIpynbCodeCellPreviewLines(source)}
            firstLineNumber={1}
            highlightedStartLine={-1}
            highlightedEndLine={-1}
            language={cell.language}
          />
        </div>
      )}
    </div>
  )
}

function IpynbSourceEditor({
  cell,
  source,
  onDeactivate,
  onChange,
  onSaveRequest
}: IpynbCellSourceProps): React.JSX.Element {
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
  const lineHeight = Math.max(SOURCE_LINE_HEIGHT_PX, Math.ceil(fontSize * 1.5))
  const maxHeight = IPYNB_CODE_CELL_PREVIEW_MAX_LINES * lineHeight
  // Seeds the first frame only; Monaco reports the real content height after mount.
  const [contentHeight, setContentHeight] = useState(
    () => getIpynbCodeCellPreviewLines(source).length * lineHeight + 2 * SOURCE_VERTICAL_PADDING_PX
  )
  const handleMount: OnMount = useCallback((editorInstance, monacoInstance) => {
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
  }, [])

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
        fontFamily: resolveEditorFontFamily(settings),
        fontSize,
        lineHeight,
        padding: { top: SOURCE_VERTICAL_PADDING_PX, bottom: SOURCE_VERTICAL_PADDING_PX },
        glyphMargin: false,
        lineNumbersMinChars: 3,
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
