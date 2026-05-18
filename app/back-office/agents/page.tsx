'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { type AgentMeta } from '../../../lib/agents/manifest'
import { getAgentWorkflows, getOrphanAgents, ALWAYS_ON_AGENTS, WORKFLOWS } from '../../../lib/agents/workflow-registry'
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  green: '#10b981',
  amber: '#f59e0b',
}

// Category labels will be handled dynamically based on language
const CATEGORY_LABEL_KEYS: Record<AgentMeta['category'], string> = {
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

// Map workflow id → display number
const WORKFLOW_NUMBER: Record<string, string> = Object.fromEntries(
  WORKFLOWS.map((w, i) => [w.id, String(i + 1)])
)

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

// ── Workflow pills ───────────────────────────────────────────────────────────

function WorkflowPills({ agentName, allNames, language }: { agentName: string; allNames: string[]; language: string }) {
  // orchestrator → special "entry" pill
  if (ALWAYS_ON_AGENTS.includes(agentName)) {
    return (
      <span style={{
        display: 'inline-block',
        fontSize: '0.62rem', fontWeight: 700,
        padding: '2px 7px', borderRadius: '999px',
        background: '#7c3aed18',
        color: '#7c3aed',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}>
        {t('agents.entry' as const, language as any)}
      </span>
    )
  }

  const orphans = getOrphanAgents(allNames)
  if (orphans.includes(agentName)) {
    return (
      <span style={{
        fontSize: '0.72rem', fontWeight: 600,
        color: C.amber,
        whiteSpace: 'nowrap',
      }}>
        ⚠ {t('agents.orphan' as const, language as any)}
      </span>
    )
  }

  const workflows = getAgentWorkflows(agentName)
  if (workflows.length === 0) return <span style={{ color: C.textFaint, fontSize: '0.72rem' }}>—</span>

  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {workflows.map(w => (
        <span
          key={w.id}
          title={w.name}
          style={{
            display: 'inline-block',
            fontSize: '0.62rem', fontWeight: 700,
            padding: '2px 7px', borderRadius: '999px',
            background: '#2563eb12',
            color: '#2563eb',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {WORKFLOW_NUMBER[w.id] ?? w.id}
        </span>
      ))}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { language } = useLanguage()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | AgentMeta['category']>('all')
  const [search, setSearch] = useState('')
  const [openFilterMenu, setOpenFilterMenu] = useState(false)

  const fetchAgents = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { setError(t('common.error' as const, language as any)); setLoading(false); return }

    const res = await fetch('/api/admin/agents', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setError(body.error ?? t('common.error' as const, language as any))
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
  const allNames = agents.map(a => a.name)

  // gridTemplateColumns: dot | name | category | model | maxTokens | stato | workflow | arrow
  const GRID = '16px 1fr 140px 160px 100px 80px 110px 32px'

  const CATEGORY_LABELS = CATEGORY_LABEL_KEYS

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>{t('agents.title' as const, language as any)}</h1>
        <p style={{ margin: '6px 0 0', fontSize: '0.88rem', color: C.textMuted }}>
          {loading ? t('agents.loading' as const, language as any) : `${agents.length} ${t('agents.totalAgents' as const, language as any)} · ${enabledCount} ${t('agents.activeAgents' as const, language as any)}`}
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: '20px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', fontSize: '0.84rem', color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Search bar */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder={t('agents.search' as const, language as any)}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            border: `1px solid ${C.border}`, borderRadius: '8px',
            padding: '8px 14px', fontSize: '0.85rem', color: C.text,
            background: C.white, outline: 'none', minWidth: '250px',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: C.textFaint, fontSize: '0.88rem', padding: '40px 0', textAlign: 'center' }}>
          {t('agents.loading' as const, language as any)}
        </div>
      ) : (
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            gap: '0 16px',
            padding: '10px 20px',
            borderBottom: `1px solid ${C.border}`,
            background: C.bg,
            position: 'relative',
          }}>
            {/* Status dot header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            </span>

            {/* Nome header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('agents.name' as const, language as any)}
            </span>

            {/* Categoria header with filter icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {t('agents.category' as const, language as any)}
              </span>
              <button
                onClick={() => setOpenFilterMenu(!openFilterMenu)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: filter !== 'all' ? C.text : C.textFaint,
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  padding: '2px 4px',
                  fontWeight: 600,
                }}
                title={filter !== 'all' ? `${t('agents.filterLabel' as const, language as any)}: ${CATEGORY_LABELS[filter as AgentMeta['category']]}` : t('agents.filterLabel' as const, language as any)}
              >
                ☰
              </button>

              {/* Filter dropdown */}
              {openFilterMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  zIndex: 10,
                  marginTop: '4px',
                  minWidth: '160px',
                }}>
                  {(['all', ...Object.keys(CATEGORY_LABELS)] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => {
                        setFilter(cat as typeof filter)
                        setOpenFilterMenu(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: 'none',
                        background: filter === cat ? C.bg : 'transparent',
                        color: C.text,
                        fontSize: '0.8rem',
                        fontWeight: filter === cat ? 600 : 400,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        borderBottom: cat !== Object.keys(CATEGORY_LABELS)[Object.keys(CATEGORY_LABELS).length - 1] && cat !== 'all' ? `1px solid ${C.border}` : 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg}
                      onMouseLeave={e => {
                        if (filter !== cat) {
                          (e.currentTarget as HTMLElement).style.background = 'transparent'
                        }
                      }}
                    >
                      {cat === 'all' ? `✓ ${t('agents.allCategories' as const, language as any)}` : CATEGORY_LABELS[cat as AgentMeta['category']]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modello header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('agents.model' as const, language as any)}
            </span>

            {/* Max tokens header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('agents.maxTokens' as const, language as any)}
            </span>

            {/* Stato header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('agents.status' as const, language as any)}
            </span>

            {/* Workflow header */}
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('agents.workflowHeader' as const, language as any)}
            </span>

            {/* Arrow header */}
            <span></span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: C.textFaint, fontSize: '0.88rem' }}>
              {t('agents.notFound' as const, language as any)}
            </div>
          ) : (
            filtered.map((agent, idx) => (
              <Link
                key={agent.name}
                href={`/back-office/agents/${agent.name}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  gap: '0 16px',
                  alignItems: 'center',
                  padding: '13px 20px',
                  textDecoration: 'none',
                  color: 'inherit',
                  borderBottom: idx < filtered.length - 1 ? `1px solid ${C.border}` : 'none',
                  background: C.white,
                  opacity: agent.enabled ? 1 : 0.55,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = C.white}
              >
                {/* Status dot */}
                <span style={{
                  display: 'inline-block', width: '7px', height: '7px',
                  borderRadius: '50%',
                  background: agent.enabled ? C.green : C.textFaint,
                  flexShrink: 0,
                }} />

                {/* Name + description */}
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {agent.displayName}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {agent.description}
                  </p>
                </div>

                {/* Category */}
                <span style={{
                  fontSize: '0.65rem', fontWeight: 600,
                  padding: '2px 8px', borderRadius: '999px',
                  background: `${CATEGORY_COLORS[agent.category] ?? '#6b7280'}15`,
                  color: CATEGORY_COLORS[agent.category] ?? '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  justifySelf: 'start',
                  whiteSpace: 'nowrap',
                }}>
                  {CATEGORY_LABELS[agent.category] ?? agent.category}
                </span>

                {/* Model */}
                <span style={{ fontSize: '0.78rem', color: C.textMuted, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {agent.model.replace('claude-', '').replace('-20251001', '')}
                </span>

                {/* Max tokens */}
                <span style={{ fontSize: '0.78rem', color: C.textFaint, fontFamily: 'monospace' }}>
                  {agent.max_tokens > 0 ? agent.max_tokens.toLocaleString() : '—'}
                </span>

                {/* Status label */}
                <span style={{
                  fontSize: '0.72rem', fontWeight: 600,
                  color: agent.enabled ? C.green : C.amber,
                }}>
                  {agent.enabled ? t('agents.active' as const, language as any) : t('agents.off' as const, language as any)}
                </span>

                {/* Workflow pills */}
                <WorkflowPills agentName={agent.name} allNames={allNames} language={language} />

                {/* Arrow */}
                <span style={{ fontSize: '0.8rem', color: C.textFaint, justifySelf: 'end' }}>→</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}
