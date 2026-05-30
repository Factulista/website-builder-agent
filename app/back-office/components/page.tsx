'use client'

import { useState } from 'react'
import Link from 'next/link'
import { COMPONENT_REGISTRY, SMART_COMPONENTS, type Component } from '../../../lib/components/index'

// ── Design token presets ──────────────────────────────────────────────────────
// Simula l'aspetto dei componenti con diversi design system.
// In produzione i componenti ereditano il vero :root del progetto via CSS vars.
const THEME_PRESETS: Record<string, { label: string; emoji: string; css: string }> = {
  blue: {
    label: 'Blu (default)',
    emoji: '🔵',
    css: `:root{--color-accent:#2563eb;--color-bg:#ffffff;--color-text:#1a1a1a;--color-secondary:#f8faff;--font-body:system-ui,sans-serif;--font-heading:system-ui,sans-serif;--radius:10px;--btn-radius:8px;}`,
  },
  green: {
    label: 'Verde',
    emoji: '🟢',
    css: `:root{--color-accent:#16a34a;--color-bg:#ffffff;--color-text:#1a1a1a;--color-secondary:#f0fdf4;--font-body:'Inter',system-ui,sans-serif;--font-heading:'Inter',system-ui,sans-serif;--radius:8px;--btn-radius:6px;}`,
  },
  orange: {
    label: 'Arancio',
    emoji: '🟠',
    css: `:root{--color-accent:#e05a2b;--color-bg:#faf9f7;--color-text:#1a1a1a;--color-secondary:#fff7f5;--font-body:'Georgia',serif;--font-heading:'Georgia',serif;--radius:6px;--btn-radius:4px;}`,
  },
  dark: {
    label: 'Scuro',
    emoji: '⚫',
    css: `:root{--color-accent:#818cf8;--color-bg:#0f172a;--color-text:#f1f5f9;--color-secondary:#1e293b;--font-body:'Segoe UI',sans-serif;--font-heading:'Segoe UI',sans-serif;--radius:12px;--btn-radius:8px;}`,
  },
  warm: {
    label: 'Warm',
    emoji: '🟡',
    css: `:root{--color-accent:#b45309;--color-bg:#fefce8;--color-text:#292524;--color-secondary:#fef9c3;--font-body:'Palatino',Georgia,serif;--font-heading:'Palatino',Georgia,serif;--radius:4px;--btn-radius:2px;}`,
  },
}

const C = {
  bg: '#faf9f7',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  border: '#e8e4de',
  blue: '#2563eb',
  green: '#059669',
  purple: '#7c3aed',
  orange: '#d97706',
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

function iframeDoc(html: string, designTokensCss: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  ${designTokensCss}
  body{margin:0;padding:1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#fff);}
</style></head><body>${html}</body></html>`
}

type View = 'table' | 'grid'

/* ── Preview Modal ─────────────────────────────────────────────────── */
function PreviewModal({ comp, onClose, designTokensCss }: { comp: Component; onClose: () => void; designTokensCss: string }) {
  const smartComp = SMART_COMPONENTS.find(c => c.id === comp.id)
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />

      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          background: C.white,
          borderRadius: '16px',
          overflow: 'hidden',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.bg, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: C.text }}>{comp.name}</span>
            <span style={{
              fontSize: '0.68rem', fontWeight: 700, color: C.white,
              background: categoryColor(comp.category),
              padding: '2px 8px', borderRadius: '4px',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {CATEGORY_LABELS[comp.category] ?? comp.category}
            </span>
            {smartComp && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: C.purple, background: '#f3e8ff', padding: '2px 8px', borderRadius: '4px' }}>
                ✨ Parametrico
              </span>
            )}
            <code style={{ fontSize: '0.72rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace', background: '#f0f0f0', padding: '2px 7px', borderRadius: '4px' }}>
              {comp.id}
            </code>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#f3f4f6', border: 'none', borderRadius: '8px',
              width: '32px', height: '32px', cursor: 'pointer',
              fontSize: '1rem', color: C.textMuted, display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Param schema strip */}
        {smartComp?.paramSchema && (
          <div style={{
            padding: '10px 20px', background: '#faf5ff',
            borderBottom: `1px solid #e9d5ff`,
            fontSize: '0.78rem', color: C.purple, flexShrink: 0,
          }}>
            <strong>Parametri agente:</strong>{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem' }}>{smartComp.paramSchema}</code>
          </div>
        )}

        {/* Description */}
        <div style={{ padding: '8px 20px', borderBottom: `1px solid ${C.border}`, fontSize: '0.78rem', color: C.textMuted, flexShrink: 0 }}>
          {comp.description}
        </div>

        {/* iframe — full width, tall */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: '420px' }}>
          <iframe
            srcDoc={iframeDoc(comp.html, designTokensCss)}
            style={{ width: '100%', height: '100%', border: 'none', minHeight: '420px' }}
            title={`Preview: ${comp.name}`}
            sandbox="allow-scripts"
          />
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────────────── */
export default function ComponentsPage() {
  const [view, setView] = useState<View>('table')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [themeKey, setThemeKey] = useState<string>('blue')

  const activeThemeCss = THEME_PRESETS[themeKey]?.css ?? THEME_PRESETS.blue.css

  const smartIds = new Set(SMART_COMPONENTS.map(c => c.id))
  const categories = ['all', ...Array.from(new Set(COMPONENT_REGISTRY.map(c => c.category)))]
  const filtered = filterCat === 'all' ? COMPONENT_REGISTRY : COMPONENT_REGISTRY.filter(c => c.category === filterCat)
  const previewComponent = previewId ? COMPONENT_REGISTRY.find(c => c.id === previewId) : null

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>

      {/* Preview Modal */}
      {previewComponent && (
        <PreviewModal comp={previewComponent} onClose={() => setPreviewId(null)} designTokensCss={activeThemeCss} />
      )}

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link href="/back-office" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>
          ← Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: C.text }}>🧩 Libreria Componenti</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: C.textMuted }}>
              {COMPONENT_REGISTRY.length} componenti · {SMART_COMPONENTS.length} parametrici · tutti adattabili via agente
            </p>
          </div>
          {/* View toggle */}
          <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            {(['table', 'grid'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '6px 14px', border: 'none',
                background: view === v ? C.text : C.white,
                color: view === v ? C.white : C.textMuted,
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {v === 'table' ? '☰ Lista' : '⊞ Griglia'}
              </button>
            ))}
          </div>
        </div>

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: '6px', marginTop: '16px', flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)} style={{
              padding: '4px 14px', borderRadius: '99px',
              border: `1px solid ${filterCat === cat ? C.text : C.border}`,
              background: filterCat === cat ? C.text : C.white,
              color: filterCat === cat ? C.white : C.textMuted,
              fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}>
              {cat === 'all' ? 'Tutti' : CATEGORY_LABELS[cat] ?? cat}
              {cat !== 'all' && <span style={{ marginLeft: '5px', opacity: 0.6 }}>{COMPONENT_REGISTRY.filter(c => c.category === cat).length}</span>}
            </button>
          ))}
        </div>

        {/* Theme picker — mostra come i componenti si adattano a diversi design system */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: C.textFaint, fontWeight: 500 }}>Tema anteprima:</span>
          {Object.entries(THEME_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => setThemeKey(key)}
              style={{
                padding: '3px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 500,
                border: `1px solid ${themeKey === key ? C.text : C.border}`,
                background: themeKey === key ? C.text : C.white,
                color: themeKey === key ? C.white : C.textMuted,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {preset.emoji} {preset.label}
            </button>
          ))}
          <span style={{ fontSize: '0.7rem', color: C.textFaint, marginLeft: '4px' }}>
            — in produzione i componenti ereditano il :root del sito
          </span>
        </div>
      </div>

      {/* ── TABLE VIEW ──────────────────────────────────────────────────── */}
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
                  style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.rowHover}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  {/* Miniatura cliccabile → apre modal */}
                  <td style={{ ...tdStyle, padding: '8px 12px', width: '100px' }}>
                    <div
                      onClick={() => setPreviewId(comp.id)}
                      title="Clicca per preview"
                      style={{
                        width: '88px', height: '56px', borderRadius: '6px',
                        overflow: 'hidden', border: `1px solid ${C.border}`,
                        background: '#fafafa', cursor: 'pointer', position: 'relative',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.blue; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${C.blue}33` }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                    >
                      <iframe
                        srcDoc={iframeDoc(comp.html, activeThemeCss)}
                        style={{ width: '352px', height: '224px', border: 'none', transform: 'scale(0.25)', transformOrigin: 'top left', pointerEvents: 'none' }}
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
                      display: 'inline-block', fontSize: '0.7rem', fontWeight: 600,
                      color: C.white, background: categoryColor(comp.category),
                      padding: '3px 8px', borderRadius: '4px',
                      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
                    }}>
                      {CATEGORY_LABELS[comp.category] ?? comp.category}
                    </span>
                  </td>

                  {/* ID */}
                  <td style={tdStyle}>
                    <code style={{ fontSize: '0.72rem', background: '#f0f0f0', color: C.textMuted, padding: '3px 7px', borderRadius: '4px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      {comp.id}
                    </code>
                  </td>

                  {/* Tipo */}
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

                  {/* Preview button */}
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      onClick={() => setPreviewId(comp.id)}
                      style={{
                        fontSize: '0.75rem', color: C.blue, background: 'transparent',
                        fontWeight: 500, padding: '4px 10px',
                        border: `1px solid ${C.blue}`, borderRadius: '6px',
                        whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.blue; (e.currentTarget as HTMLElement).style.color = C.white }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = C.blue }}
                    >
                      Preview →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── GRID VIEW ───────────────────────────────────────────────────── */}
      {view === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {filtered.map(comp => (
            <div key={comp.id} style={{
              background: C.white, border: `1px solid ${C.border}`,
              borderRadius: '10px', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              {/* iframe preview — cliccabile */}
              <div
                onClick={() => setPreviewId(comp.id)}
                style={{
                  height: '180px', overflow: 'hidden',
                  borderBottom: `1px solid ${C.border}`,
                  background: '#fafafa', position: 'relative', cursor: 'pointer',
                }}
                title="Clicca per preview"
              >
                <iframe
                  srcDoc={iframeDoc(comp.html, activeThemeCss)}
                  style={{ width: '200%', height: '360px', border: 'none', transform: 'scale(0.5)', transformOrigin: 'top left', pointerEvents: 'none' }}
                  title={comp.name}
                  sandbox="allow-scripts"
                />
                {/* Hover overlay */}
                <div className="preview-hover-overlay" style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(37,99,235,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0, transition: 'opacity 0.15s',
                }}>
                  <span style={{ background: C.blue, color: 'white', fontSize: '0.75rem', fontWeight: 700, padding: '6px 14px', borderRadius: '20px' }}>
                    👁 Preview
                  </span>
                </div>
                {smartIds.has(comp.id) && (
                  <span style={{
                    position: 'absolute', top: '8px', right: '8px',
                    fontSize: '0.65rem', fontWeight: 700, color: C.white,
                    background: C.purple, padding: '2px 7px', borderRadius: '4px',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }}>Parametrico</span>
                )}
              </div>

              {/* Card body */}
              <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: C.text }}>{comp.name}</div>
                  <span style={{
                    flexShrink: 0, fontSize: '0.65rem', fontWeight: 600,
                    color: C.white, background: categoryColor(comp.category),
                    padding: '2px 7px', borderRadius: '4px',
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>
                    {CATEGORY_LABELS[comp.category] ?? comp.category}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: C.textMuted, lineHeight: 1.4 }}>
                  {comp.description}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '6px' }}>
                  <code style={{ fontSize: '0.7rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace' }}>
                    {comp.id}
                  </code>
                  <button
                    onClick={() => setPreviewId(comp.id)}
                    style={{
                      fontSize: '0.72rem', color: C.blue, background: 'transparent',
                      border: `1px solid ${C.blue}`, borderRadius: '6px',
                      padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    }}
                  >
                    Preview →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer stats + legend */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '24px', fontSize: '0.78rem', color: C.textFaint, flexWrap: 'wrap' }}>
        <span><strong style={{ color: C.text }}>{COMPONENT_REGISTRY.length}</strong> componenti totali</span>
        <span><strong style={{ color: C.purple }}>{SMART_COMPONENTS.length}</strong> parametrici</span>
        <span><strong style={{ color: C.text }}>{categories.length - 1}</strong> categorie</span>
      </div>
      <div style={{ marginTop: '8px', display: 'flex', gap: '20px', fontSize: '0.75rem', color: C.textFaint, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.purple, display: 'inline-block' }} />
          Parametrico = testo, lingua e campi personalizzabili via agente (<code style={{ fontFamily: 'ui-monospace, monospace' }}>insert_component</code>)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.border, display: 'inline-block' }} />
          Statico = HTML fisso, da convertire in parametrico
        </span>
      </div>

      <style>{`
        div[title="Clicca per preview"]:hover .preview-hover-overlay { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 16px', textAlign: 'left',
  fontSize: '0.72rem', fontWeight: 600, color: '#6b6563',
  textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px', verticalAlign: 'middle',
}
