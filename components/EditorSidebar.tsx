'use client'

import { useState } from 'react'
import type { Page } from '../lib/types'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
}

export function EditorSidebar({
  pages,
  activeSlug,
  onPageSelect,
  onDuplicatePage,
  onDeletePage,
}: {
  pages: Page[]
  activeSlug: string
  onPageSelect: (slug: string) => void
  onDuplicatePage?: (slug: string) => void
  onDeletePage?: (slug: string) => void
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['pages']))
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const toggleSection = (section: string) => {
    const newSet = new Set(expandedSections)
    if (newSet.has(section)) {
      newSet.delete(section)
    } else {
      newSet.add(section)
    }
    setExpandedSections(newSet)
  }

  return (
    <div
      style={{
        width: '220px',
        borderRight: `1px solid ${C.border}`,
        background: C.bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            fontWeight: 700,
            color: C.textFaint,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Struttura sito
        </p>
      </div>

      {/* Pages list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {/* Pages section */}
        <div style={{ marginBottom: '4px' }}>
          <button
            onClick={() => toggleSection('pages')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: C.textMuted,
              fontSize: '0.8rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <span style={{ fontSize: '0.7rem' }}>
              {expandedSections.has('pages') ? '▼' : '▶'}
            </span>
            <span>Pagine ({pages.length})</span>
          </button>

          {expandedSections.has('pages') && (
            <div style={{ marginLeft: '12px' }}>
              {pages.map((page) => {
                const isActive = page.slug === activeSlug
                const isHovered = hoveredSlug === page.slug
                return (
                  <div
                    key={page.slug}
                    style={{ position: 'relative', margin: '2px 0' }}
                    onMouseEnter={() => setHoveredSlug(page.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                  >
                    <button
                      onClick={() => onPageSelect(page.slug)}
                      style={{
                        width: 'calc(100% - 8px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 8px',
                        // shrink right padding when action icons are visible
                        paddingRight: isHovered && (onDuplicatePage || onDeletePage) ? '44px' : '8px',
                        background: isActive ? C.blue : isHovered ? 'rgba(0,0,0,0.04)' : 'transparent',
                        border: `1px solid ${isActive ? C.blue : 'transparent'}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: isActive ? 'white' : C.text,
                        fontSize: '0.8rem',
                        fontWeight: isActive ? 600 : 400,
                        fontFamily: 'inherit',
                        textAlign: 'left',
                        transition: 'background 0.12s, color 0.12s',
                        boxSizing: 'border-box',
                      }}
                      title={page.name}
                    >
                      <span style={{ fontSize: '0.75rem' }}>📄</span>
                      <span
                        style={{
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {page.name}
                      </span>
                      {page.slug === 'home' && (
                        <span style={{ fontSize: '0.65rem', opacity: 0.7, flexShrink: 0 }}>
                          home
                        </span>
                      )}
                    </button>

                    {/* Action icons — visible on hover */}
                    {isHovered && (onDuplicatePage || onDeletePage) && (
                      <div
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          gap: '2px',
                          zIndex: 1,
                        }}
                      >
                        {onDuplicatePage && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDuplicatePage(page.slug) }}
                            title="Duplica pagina"
                            style={{
                              background: isActive ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              fontSize: '0.7rem',
                              color: isActive ? 'white' : C.textMuted,
                              lineHeight: 1,
                            }}
                          >
                            ⧉
                          </button>
                        )}
                        {onDeletePage && page.slug !== 'home' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeletePage(page.slug) }}
                            title="Elimina pagina"
                            style={{
                              background: 'rgba(239,68,68,0.1)',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              fontSize: '0.7rem',
                              color: '#ef4444',
                              lineHeight: 1,
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Info section */}
        <div
          style={{
            marginTop: '12px',
            padding: '8px',
            background: 'rgba(0,0,0,0.02)',
            borderRadius: '6px',
            borderLeft: `2px solid ${C.blue}`,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.7rem',
              color: C.textFaint,
              lineHeight: '1.4',
            }}
          >
            Clicca su una pagina per editarla nel pannello a destra
          </p>
        </div>
      </div>
    </div>
  )
}
