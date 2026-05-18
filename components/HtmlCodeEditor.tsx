'use client'

import { useState, useEffect, useRef } from 'react'

const C = {
  bg: '#1e1e1e',
  bgAlt: '#2d2d2d',
  border: '#3e3e3e',
  text: '#d4d4d4',
  textMuted: '#858585',
  white: '#ffffff',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  tag: '#569cd6',
  attr: '#9cdcfe',
  value: '#ce9178',
  comment: '#6a9955',
  keyword: '#c586c0',
  entity: '#4ec9b0',
}

function highlightHtml(code: string): string {
  let h = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  h = h.replace(/(&lt;!--.*?--&gt;)/gs, `<span style="color:${C.comment}">$1</span>`)
  h = h.replace(/(&lt;!DOCTYPE.*?&gt;)/gi, `<span style="color:${C.keyword}">$1</span>`)
  h = h.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s&gt;])/g,
    (_, b, tag, end) => `${b}<span style="color:${C.tag}">${tag}</span>${end}`
  )
  h = h.replace(
    /([a-zA-Z][a-zA-Z0-9:-]*)(=)(&quot;[^&]*?&quot;|[^\s&gt;]+)/g,
    (_, attr, eq, val) =>
      `<span style="color:${C.attr}">${attr}</span>${eq}<span style="color:${C.value}">${val}</span>`
  )
  return h
}

const LINE_HEIGHT = 20 // px — keep in sync with lineHeight style below

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
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<{ startLine: number; text: string }[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const lineNumRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchTerm.trim()) { setSearchResults([]); setCurrentSearchIndex(0); return }
    const lower = searchTerm.toLowerCase()
    const results = content.split('\n').reduce<{ startLine: number; text: string }[]>((acc, line, idx) => {
      if (line.toLowerCase().includes(lower)) acc.push({ startLine: idx, text: line })
      return acc
    }, [])
    setSearchResults(results)
    setCurrentSearchIndex(0)
  }, [searchTerm, content])

  // ── Scroll sync ───────────────────────────────────────────────────────────
  // Single source of truth: the textarea's scroll position.
  // Both the highlight layer and the line numbers mirror it.
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = e.currentTarget
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop
      highlightRef.current.scrollLeft = scrollLeft
    }
    if (lineNumRef.current) {
      lineNumRef.current.scrollTop = scrollTop
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave(content) }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchInputRef.current?.focus() }
  }

  // ── Jump helpers ──────────────────────────────────────────────────────────
  const jumpToLine = (lineNumber: number) => {
    if (!textareaRef.current) return
    const pos = content.split('\n').slice(0, lineNumber).join('\n').length + 1
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(pos, pos)
    // Sync all scroll layers
    const top = lineNumber * LINE_HEIGHT
    textareaRef.current.scrollTop = top
    if (highlightRef.current) highlightRef.current.scrollTop = top
    if (lineNumRef.current) lineNumRef.current.scrollTop = top
  }

  const goTo = (delta: 1 | -1) => {
    if (!searchResults.length) return
    const next = (currentSearchIndex + delta + searchResults.length) % searchResults.length
    setCurrentSearchIndex(next)
    jumpToLine(searchResults[next].startLine)
  }

  const lines = content.split('\n')
  const highlightedCode = highlightHtml(content)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, overflow: 'hidden' }}>

      {/* ── Search bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.bgAlt, flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: C.textMuted, flexShrink: 0 }}>
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Cerca nel codice (Ctrl+F)…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.shiftKey ? goTo(-1) : goTo(1) }
            else if (e.key === 'Escape') setSearchTerm('')
          }}
          style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: '4px', padding: '6px 8px', color: C.text, fontSize: '0.8rem', outline: 'none', fontFamily: 'monospace' }}
        />
        {searchResults.length > 0 && (
          <>
            <span style={{ fontSize: '0.75rem', color: C.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {currentSearchIndex + 1} / {searchResults.length}
            </span>
            <button onClick={() => goTo(-1)} title="Precedente (Shift+Enter)" style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '4px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 }}>▲</button>
            <button onClick={() => goTo(1)} title="Successivo (Enter)" style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '4px 6px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 }}>▼</button>
          </>
        )}
        <button onClick={() => setSearchTerm('')} title="Chiudi" style={{ background: 'transparent', border: 'none', color: C.textMuted, padding: '4px 6px', cursor: 'pointer', fontSize: '0.85rem', flexShrink: 0 }}>✕</button>
      </div>

      {/* ── Editor area ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Line numbers — scrolled in sync with textarea */}
        <div
          ref={lineNumRef}
          style={{
            width: '50px', background: C.bgAlt, borderRight: `1px solid ${C.border}`,
            padding: '12px 4px', textAlign: 'right', color: C.textMuted,
            fontSize: '0.8rem', fontFamily: 'monospace', lineHeight: `${LINE_HEIGHT}px`,
            overflowY: 'hidden', overflowX: 'hidden',
            userSelect: 'none', flexShrink: 0,
          }}
        >
          {lines.map((_, i) => <div key={i} style={{ height: LINE_HEIGHT }}>{i + 1}</div>)}
        </div>

        {/* Code pane: highlighted layer + transparent textarea on top */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Highlighted code — synced with textarea scroll, pointer-events off */}
          <div
            ref={highlightRef}
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              padding: '12px',
              fontSize: '0.8rem', fontFamily: 'monospace', lineHeight: `${LINE_HEIGHT}px`,
              color: C.text, background: C.bg,
              overflow: 'hidden',               // no scrollbar here; textarea owns it
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap', wordWrap: 'break-word',
              zIndex: 1,
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />

          {/* Transparent textarea — the real scroll owner */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => onChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              position: 'absolute', inset: 0,
              padding: '12px',
              fontSize: '0.8rem', fontFamily: 'monospace', lineHeight: `${LINE_HEIGHT}px`,
              color: 'transparent', background: 'transparent',
              border: 'none', outline: 'none', resize: 'none',
              caretColor: C.text,
              overflowY: 'auto', overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordWrap: 'break-word',
              zIndex: 2,
            }}
          />
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderTop: `1px solid ${C.border}`, background: C.bgAlt, fontSize: '0.75rem', color: C.textMuted, flexShrink: 0 }}>
        <span>{lines.length} linee · {content.length} caratteri</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saving === 'saving' && <span style={{ color: C.text }}>⏳ Salvataggio…</span>}
          {saving === 'saved' && <span style={{ color: '#4ade80' }}>✓ Salvato</span>}
          <button
            onClick={() => onSave(content)}
            disabled={saving === 'saving'}
            title="Salva (Ctrl+S)"
            style={{ background: C.blue, border: 'none', color: 'white', padding: '4px 10px', borderRadius: '3px', cursor: saving === 'saving' ? 'not-allowed' : 'pointer', fontSize: '0.75rem', opacity: saving === 'saving' ? 0.6 : 1 }}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
