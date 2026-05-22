'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getAllTemplates } from '../../../lib/templates/index'
import { supabase } from '../../../lib/supabase'

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
  rowHover: '#f5f3f0',
}

type DbTemplate = {
  id: string
  name: string
  sector: string
  keywords: string[]
  source_url: string | null
  created_at: string
  html?: string
  _source: 'db'
}

type HardcodedTemplate = {
  id: string
  name: string
  sector: string
  keywords: string[]
  description: string
  html: string
  _source: 'hardcoded'
  source_url?: null
  created_at?: null
}

type Row = DbTemplate | HardcodedTemplate

const SECTOR_COLORS: Record<string, string> = {
  Tech: C.blue,
  Fintech: C.green,
  Hospitality: C.orange,
  'Supply Chain': C.orange,
  Logistica: C.orange,
  'M&A': C.purple,
  Consulenza: C.purple,
  'AI / Builder': C.purple,
}

function sectorColor(sector: string) {
  return SECTOR_COLORS[sector] ?? C.textMuted
}

export default function TemplatesPage() {
  const hardcoded: HardcodedTemplate[] = getAllTemplates().map(t => ({ ...t, _source: 'hardcoded' as const, source_url: null, created_at: null }))
  const [dbTemplates, setDbTemplates] = useState<DbTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('templates')
      .select('id, name, sector, keywords, source_url, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) setDbTemplates((data ?? []).map((t: any) => ({ ...t, _source: 'db' as const })))
        setLoading(false)
      })
  }, [])

  const allRows: Row[] = [...hardcoded, ...dbTemplates]
  const sectors = Array.from(new Set(allRows.map(r => r.sector)))

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questo template dal DB?')) return
    setDeletingId(id)
    await supabase.from('templates').delete().eq('id', id)
    setDbTemplates(prev => prev.filter(t => t.id !== id))
    setDeletingId(null)
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link href="/back-office" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '16px' }}>
          ← Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: C.text }}>Template</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: C.textMuted }}>
              {hardcoded.length} hardcoded · {loading ? '…' : dbTemplates.length} generati da ispirazione URL
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.78rem', color: C.textFaint }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.blue, display: 'inline-block' }} /> Hardcoded
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, display: 'inline-block' }} /> Generato AI
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <th style={thStyle}>Nome</th>
              <th style={thStyle}>Settore</th>
              <th style={thStyle}>Keywords</th>
              <th style={thStyle}>Fonte</th>
              <th style={thStyle}>Tipo</th>
              <th style={thStyle}>Creato</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, i) => (
              <tr
                key={row.id + row._source}
                style={{
                  borderBottom: i < allRows.length - 1 ? `1px solid ${C.border}` : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.rowHover}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {/* Nome */}
                <td style={tdStyle}>
                  <span style={{ fontWeight: 600, color: C.text }}>{row.name}</span>
                  {row._source === 'hardcoded' && 'description' in row && (
                    <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: C.textFaint, lineHeight: 1.4, maxWidth: 280 }}>
                      {row.description.slice(0, 80)}{row.description.length > 80 ? '…' : ''}
                    </p>
                  )}
                </td>

                {/* Settore */}
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: C.white,
                    background: sectorColor(row.sector),
                    padding: '3px 8px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}>
                    {row.sector}
                  </span>
                </td>

                {/* Keywords */}
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: 260 }}>
                    {row.keywords.slice(0, 5).map(k => (
                      <span key={k} style={{
                        fontSize: '0.68rem',
                        padding: '2px 6px',
                        background: '#f0f0f0',
                        color: C.textMuted,
                        borderRadius: '3px',
                        fontFamily: 'ui-monospace, monospace',
                      }}>
                        {k}
                      </span>
                    ))}
                    {row.keywords.length > 5 && (
                      <span style={{ fontSize: '0.68rem', color: C.textFaint, padding: '2px 0' }}>+{row.keywords.length - 5}</span>
                    )}
                  </div>
                </td>

                {/* Fonte URL */}
                <td style={tdStyle}>
                  {row.source_url ? (
                    <a href={row.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: C.blue, textDecoration: 'none', wordBreak: 'break-all' }}>
                      {row.source_url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                    </a>
                  ) : (
                    <span style={{ color: C.textFaint, fontSize: '0.75rem' }}>—</span>
                  )}
                </td>

                {/* Tipo */}
                <td style={tdStyle}>
                  {row._source === 'hardcoded' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.textMuted }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.blue, display: 'inline-block', flexShrink: 0 }} />
                      Hardcoded
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: C.green }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, display: 'inline-block', flexShrink: 0 }} />
                      Generato AI
                    </span>
                  )}
                </td>

                {/* Creato */}
                <td style={tdStyle}>
                  <span style={{ fontSize: '0.75rem', color: C.textFaint, whiteSpace: 'nowrap' }}>
                    {'created_at' in row && row.created_at
                      ? new Date(row.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
                      : '—'}
                  </span>
                </td>

                {/* Azioni */}
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <Link
                      href={`/back-office/templates/${row.id}`}
                      style={{
                        fontSize: '0.75rem',
                        color: C.blue,
                        textDecoration: 'none',
                        fontWeight: 500,
                        padding: '4px 10px',
                        border: `1px solid ${C.border}`,
                        borderRadius: '6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      View →
                    </Link>
                    {row._source === 'db' && (
                      <button
                        onClick={() => handleDelete(row.id)}
                        disabled={deletingId === row.id}
                        style={{
                          fontSize: '0.75rem',
                          color: deletingId === row.id ? C.textFaint : C.red,
                          background: 'transparent',
                          border: `1px solid ${deletingId === row.id ? C.border : '#fecaca'}`,
                          borderRadius: '6px',
                          padding: '4px 10px',
                          cursor: deletingId === row.id ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {deletingId === row.id ? '…' : 'Elimina'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {loading && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: C.textFaint, padding: '24px' }}>
                  Caricamento template DB…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer stats */}
      <div style={{ marginTop: '20px', display: 'flex', gap: '24px', fontSize: '0.78rem', color: C.textFaint }}>
        <span><strong style={{ color: C.text }}>{allRows.length}</strong> template totali</span>
        <span><strong style={{ color: C.text }}>{sectors.length}</strong> settori</span>
        <span><strong style={{ color: C.text }}>{dbTemplates.length}</strong> generati da ispirazione URL</span>
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
