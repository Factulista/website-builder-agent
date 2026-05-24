'use client'

import { useState } from 'react'
import Link from 'next/link'
import { COMPONENT_REGISTRY, SMART_COMPONENTS, type Component } from '../../../lib/components/index'

const C = {
  bg: '#faf9f7',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  blue: '#2563eb',
  green: '#059669',
  purple: '#7c3aed',
  orange: '#d97706',
  red: '#dc2626',
  teal: '#0891b2',
  rowHover: '#f5f3f0',
}

const CATEGORY_LABELS: Record<string, string> = {
  form: 'Form',
  'social-proof': 'Social Proof',
  content: 'Contenuto',
  utility: 'Utility',
  navigation: 'Navigazione',
}

const CATEGORY_COLORS: Record<string, string> = {
  form: C.blue,
  'social-proof': C.green,
  content: C.orange,
  utility: C.textMuted,
  navigation: C.purple,
}

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? C.textMuted
}

function iframeDoc(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  body{margin:0;padding:1rem;font-family:system-ui,sans-serif;background:#fff;}
  :root{--color-accent:#2563eb;--font-body:system-ui,sans-serif;--color-text:#1a1a1a;--color-bg:#ffffff;--radius:10px;}
</style></head><body>${html}</body></html>`
}

type View = 'table' | 'grid'

export default function ComponentsPage() {
  const [view, setView] = useState<View>('table')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')

  const smartIds = new Set(SMART_COMPONENTS.map(c => c.id))
  const categories = ['all', ...Array.from(new Set(COMPONENT_REGISTRY.map(c => c.category)))]

  const filtered = filterCat === 'all'
    ? COMPONENT_REGISTRY
    : COMPONENT_REGISTRY.filter(c => c.category === filterCat)

  const previewComponent = previewId ? COMPONENT_REGISTRY.find(c => c.id === previewId) : null

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link href="/back-office" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>
          ← Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: C.text }}>🧩 Libreria Componenti</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: C.textMuted }}>
              {COMPONENT_REGISTRY.length} componenti · {SMART_COMPONENTS.length} parametrici (chiamabili dall&apos;agente)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* View toggle */}
            <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
              {(['table', 'grid'] as View[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    padding: '6px 14px',
                    border: 'none',
                    background: view === v ? C.text : C.white,
                    color: view === v ? C.white : C.textMuted,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {v === 'table' ? '☰ Lista' : '⊞ Griglia'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '16px', flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              style={{
                padding: '4px 14px',
                borderRadius: '99px',
                border: `1px solid ${filterCat === cat ? C.text : C.border}`,
                background: filterCat === cat ? C.text : C.white,
                color: filterCat === cat ? C.white : C.textMuted,
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {cat === 'all' ? 'Tutti' : CATEGORY_LABELS[cat] ?? cat}
              {cat !== 'all' && (
                <span style={{ marginLeft: '5px', opacity: 0.6 }}>
                  {COMPONENT_REGISTRY.filter(c => c.category === cat).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── TABLE VIEW ────────────────────────────────────────────────────── */}
      {view === 'table' && (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                <th style={{ ...thStyle, width: '100px' }}>Preview</th>
                <th style={thStyle}>Componente</th>
                <th style={thStyle}>Categoria</th>
                <th style={thStyle}>ID agente</th>
                <th style={thStyle}>Tipo</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((comp, i) => (
                <tr
                  key={comp.id}
                  style={{
                    borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.rowHover}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  {/* Miniatura preview */}
                  <td style={{ ...tdStyle, padding: '8px 12px', width: '100px' }}>
                    <div
                      onClick={() => setPreviewId(previewId === comp.id ? null : comp.id)}
                      style={{
                        width: '88px',
                        height: '56px',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        border: `1px solid ${previewId === comp.id ? C.blue : C.border}`,
                        background: '#fafafa',
                        cursor: 'pointer',
                        position: 'relative',
                        flexShrink: 0,
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                        boxShadow: previewId === comp.id ? `0 0 0 2px ${C.blue}33` : 'none',
                      }}
                      title="Clicca per preview"
                    >
                      <iframe
                        srcDoc={iframeDoc(comp.html)}
                        style={{
                          width: '352px',
                          height: '224px',
                          border: 'none',
                          transform: 'scale(0.25)',
                          transformOrigin: 'top left',
                          pointerEvents: 'none',
                        }}
                        title={comp.name}
                        sandbox="allow-scripts"
                      />
                    </div>
                  </td>

                  {/* Nome + descrizione */}
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600, color: C.text }}>{comp.name}</span>
                    <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: C.textFaint, lineHeight: 1.4, maxWidth: 340 }}>
                      {comp.description.slice(0, 100)}{comp.description.length > 100 ? '…' : ''}
                    </p>
                  </td>

                  {/* Categoria */}
                  <td style={tdStyle}>
                    <span style={{
                      display: 'inline-block',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: C.white,
                      background: categoryColor(comp.category),
                      padding: '3px 8px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}>
                      {CATEGORY_LABELS[comp.category] ?? comp.category}
                    </span>
                  </td>

                  {/* ID */}
                  <td style={tdStyle}>
                    <code style={{
                      fontSize: '0.72rem',
                      background: '#f0f0f0',
                      color: C.textMuted,
                      padding: '3px 7px',
                      borderRadius: '4px',
                      fontFamily: 'ui-monospace, monospace',
                      whiteSpace: 'nowrap',
                    }}>
                      {comp.id}
                    </code>
                  </td>

                  {/* Tipo: smart (parametrico) o statico */}
                  <td style={tdStyle}>
                    {smartIds.has(comp.id) ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.purple, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.purple, display: 'inline-block', flexShrink: 0 }} />
                        Parametrico
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.textFaint, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.border, display: 'inline-block', flexShrink: 0 }} />
                        Statico
                      </span>
                    )}
                  </td>

                  {/* Azioni */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      onClick={() => setPreviewId(previewId === comp.id ? null : comp.id)}
                      style={{
                        fontSize: '0.75rem',
                        color: previewId === comp.id ? C.white : C.blue,
                        background: previewId === comp.id ? C.blue : 'transparent',
                        textDecoration: 'none',
                        fontWeight: 500,
                        padding: '4px 10px',
                        border: `1px solid ${C.blue}`,
                        borderRadius: '6px',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {previewId === comp.id ? 'Chiudi ✕' : 'Preview →'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── GRID VIEW ─────────────────────────────────────────────────────── */}
      {view === 'grid' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '14px',
        }}>
          {filtered.map(comp => (
            <div
              key={comp.id}
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
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
                borderBottom: `1px solid ${C.border}`,
                background: '#fafafa',
                position: 'relative',
              }}>
                <iframe
                  srcDoc={iframeDoc(comp.html)}
                  style={{
                    width: '200%',
                    height: '360px',
                    border: 'none',
                    transform: 'scale(0.5)',
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                  }}
                  title={comp.name}
                  sandbox="allow-scripts"
                />
                {smartIds.has(comp.id) && (
                  <span style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    color: C.white,
                    background: C.purple,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}>
                    Parametrico
                  </span>
                )}
              </div>

              {/* Card body */}
              <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: C.text }}>{comp.name}</div>
                  <span style={{
                    flexShrink: 0,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: C.white,
                    background: categoryColor(comp.category),
                    padding: '2px 7px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}>
                    {CATEGORY_LABELS[comp.category] ?? comp.category}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: C.textMuted, lineHeight: 1.4 }}>
                  {comp.description}
                </div>
                <code style={{ fontSize: '0.7rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace', marginTop: 'auto', paddingTop: '4px' }}>
                  id: {comp.id}
                </code>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── INLINE PREVIEW PANEL ─────────────────────────────────────────── */}
      {previewComponent && (
        <div style={{
          marginTop: '20px',
          background: C.white,
          border: `1px solid ${C.blue}`,
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(37,99,235,0.1)',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: C.bg,
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: C.text }}>{previewComponent.name}</span>
              {smartIds.has(previewComponent.id) && (
                <span style={{ marginLeft: '8px', fontSize: '0.7rem', fontWeight: 700, color: C.purple, background: '#f3e8ff', padding: '2px 7px', borderRadius: '4px' }}>
                  ✨ Parametrico
                </span>
              )}
            </div>
            <button
              onClick={() => setPreviewId(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '1rem', fontFamily: 'inherit' }}
            >
              ✕
            </button>
          </div>
          {smartIds.has(previewComponent.id) && (
            <div style={{ padding: '10px 16px', background: '#faf5ff', borderBottom: `1px solid #e9d5ff`, fontSize: '0.78rem', color: C.purple }}>
              <strong>Schema parametri:</strong>{' '}
              {SMART_COMPONENTS.find(c => c.id === previewComponent.id)?.paramSchema ?? '—'}
            </div>
          )}
          <div style={{ height: '400px', overflow: 'hidden', background: '#fafafa' }}>
            <iframe
              srcDoc={iframeDoc(previewComponent.html)}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title={`Preview: ${previewComponent.name}`}
              sandbox="allow-scripts"
            />
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div style={{ marginTop: '20px', display: 'flex', gap: '24px', fontSize: '0.78rem', color: C.textFaint }}>
        <span><strong style={{ color: C.text }}>{COMPONENT_REGISTRY.length}</strong> componenti totali</span>
        <span><strong style={{ color: C.purple }}>{SMART_COMPONENTS.length}</strong> parametrici</span>
        <span><strong style={{ color: C.text }}>{categories.length - 1}</strong> categorie</span>
      </div>

      {/* Legend */}
      <div style={{ marginTop: '10px', display: 'flex', gap: '16px', fontSize: '0.75rem', color: C.textFaint }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.purple, display: 'inline-block' }} />
          Parametrico = chiamabile via agente con <code style={{ fontFamily: 'ui-monospace, monospace' }}>insert_component</code>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.border, display: 'inline-block' }} />
          Statico = HTML fisso
        </span>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#6b6563',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  verticalAlign: 'middle',
}
