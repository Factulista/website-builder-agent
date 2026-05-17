'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { type AgentMeta } from '../../../lib/agents/manifest'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#dc2626',
}

const CATEGORY_LABELS: Record<AgentMeta['category'], string> = {
  orchestration: 'Orchestrazione',
  pipeline: 'Pipeline principale',
  modifier: 'Modificatori',
  background: 'Background',
  utility: 'Utility',
}

const CATEGORY_COLORS: Record<AgentMeta['category'], string> = {
  orchestration: '#7c3aed',
  pipeline: '#2563eb',
  modifier: '#0891b2',
  background: '#6b7280',
  utility: '#10b981',
}

type AgentRow = {
  name: string
  model: string
  max_tokens: number
  enabled: boolean
  system_prompt: string | null
  updated_at: string
  displayName: string
  description: string
  category: AgentMeta['category']
  inputs: string[]
  outputs: string[]
  filePath: string
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | AgentMeta['category']>('all')
  const [search, setSearch] = useState('')

  const fetchAgents = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setError('Non autenticato'); setLoading(false); return }

    const res = await fetch('/api/admin/agents', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setError(body.error ?? 'Errore nel caricamento')
      setLoading(false)
      return
    }
    const data = await res.json() as AgentRow[]
    setAgents(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  const filtered = agents.filter(a => {
    if (filter !== 'all' && a.category !== filter) return false
    if (search && !`${a.name} ${a.displayName} ${a.description}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const enabledCount = agents.filter(a => a.enabled).length

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Agents</h1>
        <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: C.textMuted }}>
          {loading ? 'Caricamento…' : `${agents.length} agenti · ${enabledCount} attivi`}
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: '20px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', fontSize: '0.84rem', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Cerca..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            border: `1px solid ${C.border}`, borderRadius: '8px',
            padding: '7px 12px', fontSize: '0.85rem', color: C.text,
            background: C.white, outline: 'none', minWidth: '200px',
            fontFamily: 'inherit',
          }}
        />
        {(['all', ...Object.keys(CATEGORY_LABELS)] as const).map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat as typeof filter)}
            style={{
              background: filter === cat ? C.text : 'transparent',
              color: filter === cat ? 'white' : C.textMuted,
              border: `1px solid ${filter === cat ? C.text : C.border}`,
              borderRadius: '8px', padding: '7px 12px',
              fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {cat === 'all' ? 'Tutti' : CATEGORY_LABELS[cat as AgentMeta['category']]}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ color: C.textFaint, fontSize: '0.88rem', padding: '40px 0', textAlign: 'center' }}>
          Caricamento agenti…
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
          {filtered.map(agent => (
            <Link
              key={agent.name}
              href={`/back-office/agents/${agent.name}`}
              style={{
                background: C.white, border: `1px solid ${C.border}`,
                borderRadius: '12px', padding: '16px 18px',
                textDecoration: 'none', color: 'inherit',
                display: 'flex', flexDirection: 'column', gap: '8px',
                opacity: agent.enabled ? 1 : 0.6,
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = C.textFaint}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = C.border}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px',
                    borderRadius: '50%',
                    background: agent.enabled ? C.green : C.textFaint,
                    flexShrink: 0,
                  }} />
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: C.text }}>
                    {agent.displayName}
                  </h3>
                </div>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 600,
                  padding: '2px 7px', borderRadius: '999px',
                  background: `${CATEGORY_COLORS[agent.category] ?? '#6b7280'}15`,
                  color: CATEGORY_COLORS[agent.category] ?? '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>{agent.category}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: C.textMuted, lineHeight: 1.5 }}>
                {agent.description}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '0.72rem', color: C.textFaint }}>
                <span style={{ fontFamily: 'monospace' }}>{agent.model.replace('claude-', '').replace('-20251001', '')}</span>
                {agent.max_tokens > 0 && <span>· max {agent.max_tokens.toLocaleString()} tok</span>}
                {!agent.enabled && (
                  <span style={{ marginLeft: 'auto', color: C.amber, fontWeight: 600 }}>disattivato</span>
                )}
              </div>
            </Link>
          ))}
          {filtered.length === 0 && !loading && (
            <div style={{ gridColumn: '1/-1', color: C.textFaint, fontSize: '0.88rem', padding: '32px 0', textAlign: 'center' }}>
              Nessun agente trovato
            </div>
          )}
        </div>
      )}
    </div>
  )
}
