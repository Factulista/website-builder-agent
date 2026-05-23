'use client'

import { useState } from 'react'
import { COMPONENT_REGISTRY, type Component } from '../lib/components/index'

type Category = 'all' | 'form' | 'social-proof' | 'content' | 'utility'

const CATEGORY_LABELS: Record<Category, string> = {
  all: 'Tutti',
  form: 'Form',
  'social-proof': 'Social Proof',
  content: 'Contenuto',
  utility: 'Utility',
}

function iframeDoc(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{margin:0;padding:1rem;font-family:system-ui,sans-serif;background:#fff;}
  :root{--color-accent:#2563eb;--font-body:system-ui,sans-serif;--color-text:#1a1a1a;--color-bg:#ffffff;--radius:10px;}
</style></head><body>${html}</body></html>`
}

export function LibraryView({
  onInsertWithAI,
  onCopyHtml,
}: {
  onInsertWithAI: (component: Component) => void
  onCopyHtml: (html: string) => void
}) {
  const [activeCategory, setActiveCategory] = useState<Category>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filtered = activeCategory === 'all'
    ? COMPONENT_REGISTRY
    : COMPONENT_REGISTRY.filter(c => c.category === activeCategory)

  const handleCopy = (component: Component) => {
    onCopyHtml(component.html)
    setCopiedId(component.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid #e5e7eb',
        background: '#ffffff',
        flexShrink: 0,
      }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#111827' }}>
          🧩 Libreria Componenti
        </h2>
        <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#6b7280' }}>
          Inserisci componenti pronti nella tua pagina
        </p>
      </div>

      {/* Category tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '10px 16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#ffffff',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '4px 12px',
              borderRadius: '99px',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: activeCategory === cat ? '#2563eb' : '#f3f4f6',
              color: activeCategory === cat ? '#ffffff' : '#374151',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '14px',
        alignContent: 'start',
      }}>
        {filtered.map(component => (
          <div
            key={component.id}
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            {/* iframe preview */}
            <div style={{
              height: '180px',
              overflow: 'hidden',
              borderBottom: '1px solid #e5e7eb',
              background: '#fafafa',
              position: 'relative',
            }}>
              <iframe
                srcDoc={iframeDoc(component.html)}
                style={{
                  width: '200%',
                  height: '360px',
                  border: 'none',
                  transform: 'scale(0.5)',
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                }}
                title={component.name}
                sandbox="allow-scripts"
              />
            </div>

            {/* Card body */}
            <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>{component.name}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px', lineHeight: 1.4 }}>{component.description}</div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '6px', marginTop: 'auto' }}>
                <button
                  onClick={() => handleCopy(component)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: '7px',
                    background: copiedId === component.id ? '#ecfdf5' : '#ffffff',
                    color: copiedId === component.id ? '#065f46' : '#374151',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {copiedId === component.id ? '✓ Copiato!' : '📋 Copia HTML'}
                </button>
                <button
                  onClick={() => onInsertWithAI(component)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    border: 'none',
                    borderRadius: '7px',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
                >
                  ✨ Inserisci con AI
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
