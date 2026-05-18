'use client'

import { useCallback, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'

// ── Theme — VS Code Dark with standard HTML color names ──────────────────────
// Standard HTML/CSS color keywords:
// aqua #00ffff | black #000000 | blue #0000ff | fuchsia #ff00ff | gray #808080
// green #008000 | lime #00ff00 | maroon #800000 | navy #000080 | olive #808000
// purple #800080 | red #ff0000 | silver #c0c0c0 | teal #008080 | white #ffffff
// yellow #ffff00
//
// Editor palette based on VS Code Dark+ / standard web conventions:
const factTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#1e1e1e',
    backgroundImage: '',
    foreground: '#d4d4d4',        // default text
    caret: '#aeafad',
    selection: '#264f78',          // VS Code blue selection — clearly visible
    selectionMatch: '#3a3d41',
    lineHighlight: '#2a2d2e',
    gutterBackground: '#1e1e1e',
    gutterForeground: '#858585',
    gutterBorder: '#3e3e3e',
    gutterActiveForeground: '#c6c6c6',
    fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
  },
  styles: [
    // Tags: blue (#569cd6 — VS Code blue, close to "blue" #0000ff family)
    { tag: t.tagName,                color: '#569cd6' },
    { tag: t.angleBracket,           color: '#808080' },
    // Attributes: aqua/teal family (#9cdcfe — VS Code light blue, near "aqua" #00ffff)
    { tag: t.attributeName,          color: '#9cdcfe' },
    // Attribute values / strings: orange-red (#ce9178 — near "maroon"/"red" family)
    { tag: t.attributeValue,         color: '#ce9178' },
    { tag: t.string,                 color: '#ce9178' },
    // Comments: green (#6a9955 — close to "green" #008000)
    { tag: t.comment,                color: '#6a9955', fontStyle: 'italic' },
    // DOCTYPE / meta keywords: fuchsia/purple (#c586c0)
    { tag: t.keyword,                color: '#c586c0' },
    { tag: t.name,                   color: '#c586c0' },
    // Entities & special: teal (#4ec9b0 — near "teal" #008080)
    { tag: t.special(t.string),      color: '#4ec9b0' },
    { tag: t.escape,                 color: '#4ec9b0' },
    // Numbers
    { tag: t.number,                 color: '#b5cea8' },
    // URLs in href/src
    { tag: t.url,                    color: '#ce9178' },
    // Property names (CSS-in-HTML)
    { tag: t.propertyName,           color: '#9cdcfe' },
    // Operators
    { tag: t.operator,               color: '#d4d4d4' },
  ],
})

const editorExtensions = [
  html({ matchClosingTags: true, autoCloseTags: true }),
  EditorView.lineWrapping,
  EditorState.tabSize.of(2),
  EditorView.theme({
    '&': { height: '100%', fontSize: '13px' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
      lineHeight: '1.6',
    },
    '.cm-content': { padding: '12px 0' },
    '.cm-line': { padding: '0 12px' },
    '.cm-gutters': { minWidth: '48px' },
    '.cm-activeLineGutter': { background: '#2a2d2e' },
    // Selection: clearly visible blue (VS Code style)
    '.cm-selectionBackground, ::selection': { background: '#264f78 !important' },
    '.cm-focused .cm-selectionBackground': { background: '#264f78 !important' },
    // Search highlight
    '.cm-searchMatch': { background: '#515c6a', outline: '1px solid #457dff' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: '#457dff' },
    // Cursor
    '.cm-cursor': { borderLeftColor: '#aeafad', borderLeftWidth: '2px' },
  }),
]

export function HtmlCodeEditor({
  content,
  onChange,
  onSave,
  saving,
}: {
  content: string
  onChange: (content: string) => void
  onSave: (content: string) => void
  saving: 'idle' | 'saving' | 'saved'
}) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const handleChange = useCallback(
    (value: string) => onChange(value),
    [onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave(content)
      }
    },
    [onSave, content]
  )

  const lines = content.split('\n').length

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', overflow: 'hidden' }}
      onKeyDown={handleKeyDown}
    >
      {/* ── Editor ── */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <CodeMirror
          ref={editorRef}
          value={content}
          height="100%"
          theme={factTheme}
          extensions={editorExtensions}
          onChange={handleChange}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            highlightSelectionMatches: true,
            searchKeymap: true,        // Ctrl+F search built-in
            closeBracketsKeymap: true,
            defaultKeymap: true,
            historyKeymap: true,       // Ctrl+Z undo
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: false,
          }}
          style={{ height: '100%' }}
        />
      </div>

      {/* ── Status bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 14px', borderTop: '1px solid #3e3e3e',
        background: '#2d2d2d', fontSize: '0.72rem', color: '#858585', flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'monospace' }}>
          {lines} righe · {content.length} caratteri
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {saving === 'saving' && <span style={{ color: '#cccccc' }}>⏳ Salvataggio…</span>}
          {saving === 'saved'   && <span style={{ color: '#4ade80' }}>✓ Salvato</span>}
          <span style={{ color: '#555', fontSize: '0.68rem' }}>Ctrl+F cerca · Ctrl+Z annulla · Ctrl+S salva</span>
          <button
            onClick={() => onSave(content)}
            disabled={saving === 'saving'}
            title="Salva (Ctrl+S)"
            style={{
              background: '#2563eb', border: 'none', color: 'white',
              padding: '3px 12px', borderRadius: '4px',
              cursor: saving === 'saving' ? 'not-allowed' : 'pointer',
              fontSize: '0.72rem', fontWeight: 600,
              opacity: saving === 'saving' ? 0.6 : 1,
            }}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
