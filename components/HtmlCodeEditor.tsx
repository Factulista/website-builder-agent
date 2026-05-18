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
  // Syntax highlighting colors (classic programming colors)
  tag: '#569cd6', // HTML tags
  attr: '#9cdcfe', // Attributes
  value: '#ce9178', // String values
  comment: '#6a9955', // Comments
  keyword: '#c586c0', // Keywords
  entity: '#4ec9b0', // Entities & special
}

// Simple syntax highlighter for HTML
function highlightHtml(code: string): string {
  let highlighted = code
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // Comments: <!-- ... -->
  highlighted = highlighted.replace(
    /(&lt;!--.*?--&gt;)/gs,
    `<span style="color: ${C.comment}">$1</span>`
  )

  // DOCTYPE: <!DOCTYPE ...>
  highlighted = highlighted.replace(
    /(&lt;!DOCTYPE.*?&gt;)/gi,
    `<span style="color: ${C.keyword}">$1</span>`
  )

  // Tags: <tagname or </tagname
  highlighted = highlighted.replace(
    /(&lt;\/?)([a-zA-Z][a-zA-Z0-9-]*)([\s&gt;])/g,
    (match, bracket, tagName, end) => {
      return `${bracket}<span style="color: ${C.tag}">${tagName}</span>${end}`
    }
  )

  // Attributes: name=value or name="value"
  highlighted = highlighted.replace(
    /([a-zA-Z][a-zA-Z0-9:-]*)(=)(&quot;[^&]*?&quot;|[^\s&gt;]+)/g,
    (match, attrName, eq, value) => {
      return `<span style="color: ${C.attr}">${attrName}</span>${eq}<span style="color: ${C.value}">${value}</span>`
    }
  )

  return highlighted
}

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
  const [searchResults, setSearchResults] = useState<
    { startLine: number; endLine: number; text: string }[]
  >([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightedRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Update search results
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([])
      setCurrentSearchIndex(0)
      return
    }

    const lines = content.split('\n')
    const results: { startLine: number; endLine: number; text: string }[] = []
    const searchLower = searchTerm.toLowerCase()

    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(searchLower)) {
        const startPos = line.toLowerCase().indexOf(searchLower)
        results.push({
          startLine: idx,
          endLine: idx,
          text: line,
        })
      }
    })

    setSearchResults(results)
    setCurrentSearchIndex(0)
  }, [searchTerm, content])

  // Sync scroll between textarea and highlighter
  const handleScroll = (
    e: React.UIEvent<HTMLTextAreaElement>
  ) => {
    if (highlightedRef.current) {
      highlightedRef.current.scrollTop = e.currentTarget.scrollTop
      highlightedRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      onSave(content)
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      searchInputRef.current?.focus()
    }
  }

  // Jump to next search result
  const goToNextResult = () => {
    if (searchResults.length === 0) return
    const nextIndex = (currentSearchIndex + 1) % searchResults.length
    setCurrentSearchIndex(nextIndex)
    jumpToLine(searchResults[nextIndex].startLine)
  }

  // Jump to previous search result
  const goToPrevResult = () => {
    if (searchResults.length === 0) return
    const prevIndex =
      currentSearchIndex === 0 ? searchResults.length - 1 : currentSearchIndex - 1
    setCurrentSearchIndex(prevIndex)
    jumpToLine(searchResults[prevIndex].startLine)
  }

  // Jump to specific line
  const jumpToLine = (lineNumber: number) => {
    if (!textareaRef.current) return
    const lines = content.substring(0, textareaRef.current.selectionStart).split('\n')
    const pos = content
      .split('\n')
      .slice(0, lineNumber)
      .join('\n').length + 1
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(pos, pos)
    textareaRef.current.scrollTop = lineNumber * 20
  }

  const highlightedCode = highlightHtml(content)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: C.bg,
        overflow: 'hidden',
      }}
    >
      {/* Search bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: C.bgAlt,
          flexShrink: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ color: C.textMuted, flexShrink: 0 }}
        >
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Cerca nel codice (Ctrl+F)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: '4px',
            padding: '6px 8px',
            color: C.text,
            fontSize: '0.8rem',
            outline: 'none',
            fontFamily: 'monospace',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.shiftKey ? goToPrevResult() : goToNextResult()
            } else if (e.key === 'Escape') {
              setSearchTerm('')
            }
          }}
        />

        {searchResults.length > 0 && (
          <>
            <span
              style={{
                fontSize: '0.75rem',
                color: C.textMuted,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {currentSearchIndex + 1} / {searchResults.length}
            </span>
            <button
              onClick={goToPrevResult}
              title="Risultato precedente (Shift+Enter)"
              style={{
                background: 'transparent',
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: '4px 6px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                flexShrink: 0,
              }}
            >
              ▲
            </button>
            <button
              onClick={goToNextResult}
              title="Risultato successivo (Enter)"
              style={{
                background: 'transparent',
                border: `1px solid ${C.border}`,
                color: C.text,
                padding: '4px 6px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                flexShrink: 0,
              }}
            >
              ▼
            </button>
          </>
        )}

        <button
          onClick={() => setSearchTerm('')}
          title="Chiudi ricerca"
          style={{
            background: 'transparent',
            border: 'none',
            color: C.textMuted,
            padding: '4px 6px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Code editor area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Line numbers */}
        <div
          style={{
            width: '50px',
            background: C.bgAlt,
            borderRight: `1px solid ${C.border}`,
            padding: '12px 4px',
            textAlign: 'right',
            color: C.textMuted,
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            overflowY: 'hidden',
            userSelect: 'none',
            flexShrink: 0,
            lineHeight: '1.6',
          }}
        >
          {content.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Highlighted code (background) */}
          <div
            ref={highlightedRef}
            style={{
              position: 'absolute',
              inset: 0,
              padding: '12px 12px',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              lineHeight: '1.6',
              color: 'transparent',
              background: C.bg,
              overflow: 'hidden',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />

          {/* Textarea (input) */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              position: 'absolute',
              inset: 0,
              padding: '12px 12px',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              lineHeight: '1.6',
              color: 'transparent',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              zIndex: 2,
              caretColor: C.text,
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          />

          {/* Actual code display (for visual reference) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              padding: '12px 12px',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              lineHeight: '1.6',
              color: C.text,
              background: C.bg,
              overflow: 'hidden',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              zIndex: 1,
            }}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>
      </div>

      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderTop: `1px solid ${C.border}`,
          background: C.bgAlt,
          fontSize: '0.75rem',
          color: C.textMuted,
          flexShrink: 0,
        }}
      >
        <span>
          {content.split('\n').length} linee • {content.length} caratteri
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saving === 'saving' && (
            <span style={{ color: C.text }}>⏳ Salvataggio...</span>
          )}
          {saving === 'saved' && (
            <span style={{ color: '#4ade80' }}>✓ Salvato</span>
          )}
          <button
            onClick={() => onSave(content)}
            disabled={saving === 'saving'}
            title="Salva (Ctrl+S)"
            style={{
              background: C.blue,
              border: 'none',
              color: 'white',
              padding: '4px 10px',
              borderRadius: '3px',
              cursor: saving === 'saving' ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
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
