'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getTemplate } from '../../../../lib/templates/index'

const C = {
  bg: '#faf9f7',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  blue: '#2563eb',
  red: '#ef4444',
}

export default function TemplateDetailPage() {
  const params = useParams()
  const id = params?.id as string
  const template = getTemplate(id)

  if (!template) {
    return (
      <div style={{ padding: '32px 40px' }}>
        <Link href="/back-office/templates" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none' }}>
          ← Template
        </Link>
        <div style={{ marginTop: '20px', color: C.red, fontSize: '0.9rem' }}>
          Template non trovato.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>
      {/* Back link */}
      <Link href="/back-office/templates" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '20px' }}>
        ← Template
      </Link>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 700, color: C.text }}>
            {template.name}
          </h1>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: C.white,
            background: C.blue,
            padding: '5px 12px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {template.sector}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.95rem', color: C.textMuted }}>
          {template.description}
        </p>
      </div>

      {/* Meta info */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '20px',
      }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            ID Template
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '0.9rem', fontFamily: 'ui-monospace, monospace', color: C.text, fontWeight: 500 }}>
            {template.id}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Settore
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '0.9rem', color: C.text, fontWeight: 500 }}>
            {template.sector}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dimensione HTML
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '0.9rem', color: C.text, fontWeight: 500 }}>
            {(template.html.length / 1024).toFixed(1)} kB
          </p>
        </div>
      </div>

      {/* Keywords section */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: C.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Keywords per rilevamento
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {template.keywords.map(keyword => (
            <span
              key={keyword}
              style={{
                fontSize: '0.8rem',
                padding: '6px 12px',
                background: '#f0f0f0',
                color: C.textMuted,
                borderRadius: '6px',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>

      {/* HTML Preview */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: C.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Preview HTML
        </h2>
        <div style={{
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
          <iframe
            srcDoc={template.html}
            style={{
              width: '100%',
              height: '600px',
              border: 'none',
            }}
            title={`Preview: ${template.name}`}
          />
        </div>
      </div>

      {/* HTML Code */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 600, color: C.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Codice HTML
        </h2>
        <div style={{
          background: '#1a1a1a',
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          padding: '16px',
          overflow: 'auto',
          maxHeight: '400px',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.75rem',
          color: '#e0e0e0',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {template.html.substring(0, 2000)}...
        </div>
      </div>
    </div>
  )
}
