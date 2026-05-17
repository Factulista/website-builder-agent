'use client'

import Link from 'next/link'
import { getAllTemplates } from '../../../lib/templates/index'

const C = {
  bg: '#faf9f7',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  blue: '#2563eb',
  green: '#10b981',
}

export default function TemplatesPage() {
  const templates = getAllTemplates()

  // Group templates by sector
  const sectors = Array.from(new Set(templates.map(t => t.sector)))
  const templatesBySector = Object.fromEntries(
    sectors.map(sector => [sector, templates.filter(t => t.sector === sector)])
  )

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/back-office" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '20px' }}>
          ← Back Office
        </Link>
      </div>

      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text, marginBottom: '6px' }}>
        Template
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: C.textMuted }}>
        Libreria dei template base per i siti web, organizzati per settore.
      </p>

      {Object.entries(templatesBySector).map(([sector, sectorTemplates]) => (
        <div key={sector} style={{ marginBottom: '32px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 600, color: C.text }}>
            {sector}
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}>
            {sectorTemplates.map(template => (
              <div
                key={template.id}
                style={{
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = C.borderStrong
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = C.border
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: C.text }}>
                      {template.name}
                    </h3>
                    <span style={{
                      display: 'inline-block',
                      marginTop: '6px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: C.white,
                      background: C.blue,
                      padding: '4px 10px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {template.sector}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  color: C.textMuted,
                  lineHeight: 1.5,
                }}>
                  {template.description}
                </p>

                {/* Keywords */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {template.keywords.slice(0, 4).map(keyword => (
                    <span
                      key={keyword}
                      style={{
                        fontSize: '0.7rem',
                        padding: '3px 8px',
                        background: '#f0f0f0',
                        color: C.textMuted,
                        borderRadius: '4px',
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      {keyword}
                    </span>
                  ))}
                  {template.keywords.length > 4 && (
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '3px 8px',
                      color: C.textFaint,
                      fontWeight: 600,
                    }}>
                      +{template.keywords.length - 4}
                    </span>
                  )}
                </div>

                {/* ID */}
                <div style={{
                  paddingTop: '12px',
                  borderTop: `1px solid ${C.border}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: '0.75rem',
                    color: C.textFaint,
                    fontFamily: 'ui-monospace, monospace',
                  }}>
                    ID: {template.id}
                  </span>
                  <Link
                    href={`/back-office/templates/${template.id}`}
                    style={{
                      fontSize: '0.8rem',
                      color: C.blue,
                      textDecoration: 'none',
                      fontWeight: 500,
                      padding: '4px 12px',
                      borderRadius: '6px',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#eff6ff'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    Visualizza →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Stats footer */}
      <div style={{
        marginTop: '40px',
        paddingTop: '24px',
        borderTop: `1px solid ${C.border}`,
        display: 'flex',
        gap: '24px',
        fontSize: '0.8rem',
        color: C.textMuted,
      }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: C.text }}>
            {templates.length}
          </p>
          <p style={{ margin: '2px 0 0', color: C.textFaint }}>
            Template totali
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: C.text }}>
            {sectors.length}
          </p>
          <p style={{ margin: '2px 0 0', color: C.textFaint }}>
            Settori
          </p>
        </div>
      </div>
    </div>
  )
}
