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
}

export function EditorSidebar({
  pages,
  activeSlug,
  onPageSelect,
  hasBlog,
  isBlogActive,
  onBlogSelect,
}: {
  pages: Page[]
  activeSlug: string
  onPageSelect: (slug: string) => void
  hasBlog?: boolean
  isBlogActive?: boolean
  onBlogSelect?: () => void
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['pages']))

  const toggleSection = (section: string) => {
    const newSet = new Set(expandedSections)
    if (newSet.has(section)) newSet.delete(section)
    else newSet.add(section)
    setExpandedSections(newSet)
  }

  return (
    <div style={{
      width: '220px',
      borderRight: `1px solid ${C.border}`,
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Struttura sito
        </p>
      </div>

      {/* Pages list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        <div style={{ marginBottom: '4px' }}>
          <button
            onClick={() => toggleSection('pages')}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <span style={{ fontSize: '0.7rem' }}>{expandedSections.has('pages') ? '▼' : '▶'}</span>
            <span>Pagine ({pages.length + (hasBlog ? 1 : 0)})</span>
          </button>

          {expandedSections.has('pages') && (
            <div style={{ marginLeft: '12px' }}>
              {pages.map((page) => (
                <button
                  key={page.slug}
                  onClick={() => onPageSelect(page.slug)}
                  style={{
                    width: 'calc(100% - 8px)',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 8px', margin: '2px 0',
                    background: !isBlogActive && page.slug === activeSlug ? C.blue : 'transparent',
                    border: `1px solid ${!isBlogActive && page.slug === activeSlug ? C.blue : 'transparent'}`,
                    borderRadius: '6px', cursor: 'pointer',
                    color: !isBlogActive && page.slug === activeSlug ? 'white' : C.text,
                    fontSize: '0.8rem', fontWeight: !isBlogActive && page.slug === activeSlug ? 600 : 400,
                    fontFamily: 'inherit', textAlign: 'left',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={(e) => { if (isBlogActive || page.slug !== activeSlug) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={(e) => { if (isBlogActive || page.slug !== activeSlug) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  title={page.name}
                >
                  <span style={{ fontSize: '0.75rem' }}>📄</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.name}
                  </span>
                  {page.slug === 'home' && (
                    <span style={{ fontSize: '0.65rem', opacity: 0.7, flexShrink: 0 }}>home</span>
                  )}
                </button>
              ))}
              {hasBlog && onBlogSelect && (
                <button
                  onClick={onBlogSelect}
                  style={{
                    width: 'calc(100% - 8px)',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 8px', margin: '2px 0',
                    background: isBlogActive ? C.blue : 'transparent',
                    border: `1px solid ${isBlogActive ? C.blue : 'transparent'}`,
                    borderRadius: '6px', cursor: 'pointer',
                    color: isBlogActive ? 'white' : C.text,
                    fontSize: '0.8rem', fontWeight: isBlogActive ? 600 : 400,
                    fontFamily: 'inherit', textAlign: 'left',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={(e) => { if (!isBlogActive) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={(e) => { if (!isBlogActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  title="Blog"
                >
                  <span style={{ fontSize: '0.75rem' }}>📝</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Blog
                  </span>
                  <span style={{ fontSize: '0.6rem', opacity: 0.65, flexShrink: 0, background: 'rgba(255,255,255,0.25)', borderRadius: '3px', padding: '1px 4px' }}>
                    dinamico
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: '12px', padding: '8px', background: 'rgba(0,0,0,0.02)', borderRadius: '6px', borderLeft: `2px solid ${C.blue}` }}>
          <p style={{ margin: 0, fontSize: '0.7rem', color: C.textFaint, lineHeight: '1.4' }}>
            Clicca su una pagina per editarla nel pannello a destra
          </p>
        </div>
      </div>
    </div>
  )
}
