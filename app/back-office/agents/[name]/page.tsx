'use client'

import { use, useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import { AGENTS_MANIFEST } from '../../../../lib/agents/manifest'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  green: '#10b981',
  blue: '#2563eb',
  red: '#ef4444',
  yellow: '#f59e0b',
}

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20251001', label: 'Sonnet 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 ✨' },
  { value: 'claude-opus-4-5-20251001', label: 'Opus 4.5' },
]

type TabId = 'config' | 'runs' | 'memory' | 'stats'

type AgentData = {
  name: string
  model: string
  max_tokens: number
  enabled: boolean
  system_prompt: string | null
  updated_at: string
  displayName: string
  description: string
  category: string
  inputs: string[]
  outputs: string[]
  filePath: string
}

type PromptVersion = {
  id: string
  agent_name: string
  system_prompt: string
  model: string
  max_tokens: number
  created_at: string
  label: string | null
}

type Draft = {
  model: string
  max_tokens: number
  system_prompt: string
}

type AgentRun = {
  id: string
  project_id: string | null
  status: string
  input_summary: string | null
  output_summary: string | null
  error_message: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  duration_ms: number | null
  model: string | null
  created_at: string
  completed_at: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
}

type ProjectCtx = {
  id: string
  name: string
  slug: string
  context: string | null
}

type AgentStats = {
  rows: Array<{ status: string; count: number; avg_duration: number | null; total_tokens: number | null; total_cache: number | null }>
  last24h: number
  last7d: number
  recentErrors: string[]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

function formatRunTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${hh}:${min}:${sec} · ${dd}/${mm}`
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function shortModel(model: string): string {
  const opt = MODEL_OPTIONS.find(o => o.value === model)
  if (opt) return opt.label
  return model.replace('claude-', '').replace('-20251001', '')
}

function truncate(s: string | null, len: number): string {
  if (!s) return '—'
  return s.length > len ? s.slice(0, len) + '…' : s
}

export default function AgentDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)

  const [agent, setAgent] = useState<AgentData | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFeedback, setSavedFeedback] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('config')

  // Run Recenti state
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const runsLoadedRef = useRef(false)
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Memoria Progetti state
  const [projectContexts, setProjectContexts] = useState<ProjectCtx[]>([])
  const [contextsLoading, setContextsLoading] = useState(false)
  const [expandedCtxId, setExpandedCtxId] = useState<string | null>(null)
  const contextsLoadedRef = useRef(false)

  // Statistiche state
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const statsLoadedRef = useRef(false)

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  const fetchAgent = useCallback(async () => {
    const token = await getToken()
    if (!token) { setError('Non autenticato'); setLoading(false); return }

    const res = await fetch(`/api/admin/agents/${name}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json() as { error?: string }
      setError(body.error ?? 'Errore nel caricamento')
      setLoading(false)
      return
    }
    const data = await res.json() as AgentData
    setAgent(data)
    setDraft({
      model: data.model,
      max_tokens: data.max_tokens,
      system_prompt: data.system_prompt ?? '',
    })
    setLoading(false)
  }, [name, getToken])

  const fetchVersions = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const res = await fetch(`/api/admin/agents/${name}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json() as PromptVersion[]
      setVersions(data)
    }
  }, [name, getToken])

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true)
    setRunsError(null)
    try {
      const { data, error: dbError } = await supabase
        .from('agent_runs')
        .select('id, project_id, status, input_summary, output_summary, error_message, input_tokens, output_tokens, cache_read_tokens, duration_ms, model, created_at, completed_at, input_data, output_data')
        .eq('agent_type', name)
        .order('created_at', { ascending: false })
        .limit(50)
      if (dbError) {
        if (dbError.message.includes('does not exist') || dbError.code === '42P01') {
          setRunsError('Dati non disponibili — esegui la migration SQL per creare la tabella agent_runs')
        } else {
          setRunsError(dbError.message)
        }
        return
      }
      setRuns((data as AgentRun[]) ?? [])
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'Errore sconosciuto')
    } finally {
      setRunsLoading(false)
    }
  }, [name])

  const fetchContexts = useCallback(async () => {
    setContextsLoading(true)
    try {
      const { data } = await supabase
        .from('projects')
        .select('id, name, slug, site_config')
        .not('site_config', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(30)
      const mapped: ProjectCtx[] = ((data ?? []) as Array<{ id: string; name: string; slug: string; site_config: Record<string, unknown> | null }>)
        .map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          context: p.site_config?.context != null ? (typeof p.site_config.context === 'string' ? p.site_config.context : JSON.stringify(p.site_config.context)) : null,
        }))
        .filter(p => p.context !== null)
      setProjectContexts(mapped)
    } catch {
      setProjectContexts([])
    } finally {
      setContextsLoading(false)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const { data: aggData, error: aggError } = await supabase
        .from('agent_runs')
        .select('status, duration_ms, input_tokens, output_tokens, cache_read_tokens, error_message')
        .eq('agent_type', name)

      if (aggError) {
        if (aggError.message.includes('does not exist') || aggError.code === '42P01') {
          setStatsError('Dati non disponibili — esegui la migration SQL per creare la tabella agent_runs')
        } else {
          setStatsError(aggError.message)
        }
        return
      }

      const rows = aggData ?? []
      const now = new Date()
      const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

      const { data: last24hData } = await supabase
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('agent_type', name)
        .gte('created_at', h24.toISOString())

      const { data: last7dData } = await supabase
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('agent_type', name)
        .gte('created_at', d7.toISOString())

      const { count: count24h } = await supabase
        .from('agent_runs')
        .select('*', { count: 'exact', head: true })
        .eq('agent_type', name)
        .gte('created_at', h24.toISOString())

      const { count: count7d } = await supabase
        .from('agent_runs')
        .select('*', { count: 'exact', head: true })
        .eq('agent_type', name)
        .gte('created_at', d7.toISOString())

      // aggregate by status
      const statusMap: Record<string, { count: number; sumDuration: number; durCount: number; totalTokens: number; totalCache: number }> = {}
      for (const r of rows as Array<{ status: string; duration_ms: number | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; error_message: string | null }>) {
        if (!statusMap[r.status]) statusMap[r.status] = { count: 0, sumDuration: 0, durCount: 0, totalTokens: 0, totalCache: 0 }
        statusMap[r.status].count++
        if (r.duration_ms !== null) { statusMap[r.status].sumDuration += r.duration_ms; statusMap[r.status].durCount++ }
        statusMap[r.status].totalTokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
        statusMap[r.status].totalCache += r.cache_read_tokens ?? 0
      }

      const aggRows = Object.entries(statusMap).map(([status, v]) => ({
        status,
        count: v.count,
        avg_duration: v.durCount > 0 ? v.sumDuration / v.durCount : null,
        total_tokens: v.totalTokens,
        total_cache: v.totalCache,
      }))

      const recentErrors = (rows as Array<{ status: string; error_message: string | null }>)
        .filter(r => r.status === 'failed' && r.error_message)
        .slice(0, 3)
        .map(r => r.error_message as string)

      void last24hData
      void last7dData

      setStats({
        rows: aggRows,
        last24h: count24h ?? 0,
        last7d: count7d ?? 0,
        recentErrors,
      })
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Errore sconosciuto')
    } finally {
      setStatsLoading(false)
    }
  }, [name])

  useEffect(() => {
    fetchAgent()
    fetchVersions()
  }, [fetchAgent, fetchVersions])

  // Lazy load on tab switch
  useEffect(() => {
    if (activeTab === 'runs' && !runsLoadedRef.current) {
      runsLoadedRef.current = true
      fetchRuns()
    }
    if (activeTab === 'memory' && !contextsLoadedRef.current && name === 'memory') {
      contextsLoadedRef.current = true
      fetchContexts()
    }
    if (activeTab === 'stats' && !statsLoadedRef.current) {
      statsLoadedRef.current = true
      fetchStats()
    }
  }, [activeTab, name, fetchRuns, fetchContexts, fetchStats])

  // Auto-refresh for runs tab
  useEffect(() => {
    if (autoRefresh && activeTab === 'runs') {
      autoRefreshIntervalRef.current = setInterval(() => {
        fetchRuns()
      }, 10000)
    } else {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current)
        autoRefreshIntervalRef.current = null
      }
    }
    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current)
        autoRefreshIntervalRef.current = null
      }
    }
  }, [autoRefresh, activeTab, fetchRuns])

  const isDirty = agent !== null && draft !== null && (
    draft.model !== agent.model ||
    draft.max_tokens !== agent.max_tokens ||
    draft.system_prompt !== (agent.system_prompt ?? '')
  )

  const handleSave = async () => {
    if (!draft || !agent) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/admin/agents/${name}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: draft.model,
          max_tokens: draft.max_tokens,
          system_prompt: draft.system_prompt,
        }),
      })
      if (res.ok) {
        const updated = await res.json() as AgentData
        setAgent(updated)
        setDraft({
          model: updated.model,
          max_tokens: updated.max_tokens,
          system_prompt: updated.system_prompt ?? '',
        })
        setSavedFeedback(true)
        setTimeout(() => setSavedFeedback(false), 2000)
        await fetchVersions()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async () => {
    if (!agent) return
    setTogglingEnabled(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/admin/agents/${name}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: !agent.enabled }),
      })
      if (res.ok) {
        const updated = await res.json() as AgentData
        setAgent(updated)
      }
    } finally {
      setTogglingEnabled(false)
    }
  }

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/admin/agents/${name}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ versionId }),
      })
      if (res.ok) {
        await fetchAgent()
        await fetchVersions()
      }
    } finally {
      setRestoringId(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 40px', color: C.textMuted, fontSize: '0.9rem' }}>
        Caricamento...
      </div>
    )
  }

  if (error || !agent || !draft) {
    const isMigration = error?.includes('migration') || error?.includes('Tabelle DB')
    return (
      <div style={{ padding: '32px 40px', maxWidth: '720px' }}>
        <Link href="/back-office/agents" style={{ fontSize: '0.82rem', color: C.textMuted, textDecoration: 'none' }}>
          ← Tutti gli agenti
        </Link>
        {isMigration ? (
          <div style={{ marginTop: '20px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '10px', padding: '16px 20px' }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: '0.9rem', color: '#713f12' }}>⚠ Migration SQL richiesta</p>
            <p style={{ margin: '0 0 12px', fontSize: '0.84rem', color: '#78350f', lineHeight: 1.6 }}>
              Le tabelle <code style={{ fontFamily: 'monospace', background: '#fef08a', padding: '1px 4px', borderRadius: '3px' }}>agent_configs</code> e{' '}
              <code style={{ fontFamily: 'monospace', background: '#fef08a', padding: '1px 4px', borderRadius: '3px' }}>agent_prompt_versions</code>{' '}
              non esistono ancora. Esegui questo SQL nel tuo progetto Supabase:
            </p>
            <pre style={{ margin: 0, background: '#1e1e1e', color: '#d4d4d4', borderRadius: '8px', padding: '12px 14px', fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{`CREATE TABLE agent_configs (
  name TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  system_prompt TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL REFERENCES agent_configs(name) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label TEXT
);`}</pre>
          </div>
        ) : (
          <p style={{ color: '#ef4444', marginTop: '16px', fontSize: '0.88rem' }}>{error ?? 'Agente non trovato'}</p>
        )}
      </div>
    )
  }

  const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'config', label: 'Configurazione' },
    { id: 'runs', label: 'Run Recenti' },
    { id: 'memory', label: 'Memoria Progetti' },
    { id: 'stats', label: 'Statistiche' },
  ]

  return (
    <div style={{ padding: '32px 40px', maxWidth: '960px' }}>
      <Link
        href="/back-office/agents"
        style={{ fontSize: '0.82rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '12px' }}
      >
        ← Tutti gli agenti
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '6px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>{agent.displayName}</h1>
            {/* Enabled toggle */}
            <button
              onClick={handleToggleEnabled}
              disabled={togglingEnabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '999px',
                border: `1px solid ${agent.enabled ? C.green : C.border}`,
                background: agent.enabled ? '#ecfdf5' : C.white,
                color: agent.enabled ? C.green : C.textMuted,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: togglingEnabled ? 'wait' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: agent.enabled ? C.green : C.textFaint,
                flexShrink: 0,
              }} />
              {agent.enabled ? 'Attivo' : 'Disattivato'}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: C.textFaint, fontFamily: 'monospace' }}>
            {agent.name} · {agent.filePath}
          </p>
        </div>
        <span style={{
          fontSize: '0.7rem', padding: '4px 10px', borderRadius: '999px',
          background: '#e8e4de', color: C.textMuted, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
        }}>
          {agent.category}
        </span>
      </div>

      <p style={{ margin: '14px 0 24px', fontSize: '0.92rem', color: C.textMuted, lineHeight: 1.6 }}>
        {agent.description}
      </p>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: '0',
        borderBottom: `2px solid ${C.border}`,
        marginBottom: '24px',
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 18px',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? `2px solid ${C.blue}` : '2px solid transparent',
                marginBottom: '-2px',
                fontSize: '0.88rem',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.blue : C.textMuted,
                cursor: 'pointer',
                transition: 'color 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab: Configurazione */}
      {activeTab === 'config' && (
        <div style={{ overflowY: 'auto' }}>
          {/* Regole operative */}
          {(() => {
            const meta = AGENTS_MANIFEST.find(a => a.name === agent.name)
            if (!meta?.rules?.length) return null
            return (
              <div style={{
                background: '#f8faff',
                border: '1px solid #c7d7f8',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: '24px',
              }}>
                <p style={{
                  margin: '0 0 10px',
                  fontSize: '0.68rem',
                  color: '#1e40af',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  🛡️ Guardrail attivi
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {meta.rules.map((rule, i) => {
                    const isBlock = rule.startsWith('❌') || rule.startsWith('🚫')
                    const isAllow = rule.startsWith('✅') || rule.startsWith('🎯')
                    const bg = isBlock ? '#fff1f2' : isAllow ? '#f0fdf4' : '#f8faff'
                    const border = isBlock ? '#fecaca' : isAllow ? '#bbf7d0' : '#e0e7ff'
                    return (
                      <li key={i} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '0.82rem',
                        color: '#1e293b',
                        lineHeight: 1.5,
                        background: bg,
                        border: `1px solid ${border}`,
                        borderRadius: '6px',
                        padding: '5px 10px',
                      }}>
                        {rule}
                      </li>
                    )
                  })}
                </ul>
                <p style={{ margin: '10px 0 0', fontSize: '0.68rem', color: '#6b7280' }}>
                  Definiti in <code style={{ fontFamily: 'monospace', background: '#e0e7ff', padding: '1px 4px', borderRadius: '3px' }}>{agent.filePath}</code> — modificabili solo via codice
                </p>
              </div>
            )
          })()}

          {/* Stats row: model + max_tokens */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
            {/* Model dropdown */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Modello
              </p>
              <select
                value={draft.model}
                onChange={e => setDraft(d => d ? { ...d, model: e.target.value } : d)}
                style={{
                  width: '100%', border: 'none', background: 'transparent',
                  fontSize: '0.92rem', color: C.text, fontWeight: 600, fontFamily: 'monospace',
                  cursor: 'pointer', outline: 'none', padding: 0,
                }}
              >
                {MODEL_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
                {!MODEL_OPTIONS.find(o => o.value === draft.model) && (
                  <option value={draft.model}>{draft.model}</option>
                )}
              </select>
            </div>

            {/* Max tokens input */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Max Tokens
              </p>
              <input
                type="number"
                value={draft.max_tokens}
                min={1}
                max={200000}
                onChange={e => setDraft(d => d ? { ...d, max_tokens: parseInt(e.target.value, 10) || 0 } : d)}
                style={{
                  width: '100%', border: 'none', background: 'transparent',
                  fontSize: '0.92rem', color: C.text, fontWeight: 600, fontFamily: 'monospace',
                  outline: 'none', padding: 0,
                }}
              />
            </div>
          </div>

          {/* System prompt textarea */}
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <p style={{ margin: 0, fontSize: '0.7rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                System Prompt
              </p>
              <span style={{ fontSize: '0.72rem', color: C.textFaint }}>
                {draft.system_prompt.length} caratteri
              </span>
            </div>
            <textarea
              value={draft.system_prompt}
              onChange={e => setDraft(d => d ? { ...d, system_prompt: e.target.value } : d)}
              style={{
                width: '100%',
                minHeight: '300px',
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                padding: '12px',
                fontSize: '0.82rem',
                lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: C.text,
                background: '#fafaf9',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Save button */}
          {isDirty && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px',
                  background: C.text,
                  color: C.white,
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: saving ? 'wait' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Salvataggio...' : 'Salva modifiche'}
              </button>
              {savedFeedback && (
                <span style={{ fontSize: '0.85rem', color: C.green, fontWeight: 600 }}>
                  ✓ Salvato
                </span>
              )}
            </div>
          )}

          {savedFeedback && !isDirty && (
            <div style={{ marginBottom: '24px' }}>
              <span style={{ fontSize: '0.85rem', color: C.green, fontWeight: 600 }}>
                ✓ Salvato
              </span>
            </div>
          )}

          {/* Versions panel */}
          {versions.length > 0 && (
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '24px' }}>
              <p style={{ margin: '0 0 12px', fontSize: '0.7rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Versioni precedenti
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {versions.map(v => (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: `1px solid ${C.border}`,
                      background: C.bg,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: C.textMuted, fontWeight: 600 }}>
                          {formatDate(v.created_at)}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: C.textFaint, fontFamily: 'monospace' }}>
                          {shortModel(v.model)}
                        </span>
                        {v.label && (
                          <span style={{ fontSize: '0.68rem', color: C.textFaint, fontStyle: 'italic' }}>
                            {v.label}
                          </span>
                        )}
                      </div>
                      <p style={{
                        margin: 0,
                        fontSize: '0.78rem',
                        color: C.textMuted,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>
                        {v.system_prompt.slice(0, 100)}{v.system_prompt.length > 100 ? '…' : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestore(v.id)}
                      disabled={restoringId === v.id}
                      style={{
                        padding: '6px 12px',
                        background: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        color: C.textMuted,
                        cursor: restoringId === v.id ? 'wait' : 'pointer',
                        flexShrink: 0,
                        fontWeight: 500,
                      }}
                    >
                      {restoringId === v.id ? '...' : 'Ripristina'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Run Recenti */}
      {activeTab === 'runs' && (
        <div style={{ overflowY: 'auto' }}>
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <button
              onClick={() => fetchRuns()}
              disabled={runsLoading}
              style={{
                padding: '6px 14px',
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: '6px',
                fontSize: '0.82rem',
                color: C.text,
                cursor: runsLoading ? 'wait' : 'pointer',
                fontWeight: 500,
              }}
            >
              🔄 Aggiorna
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: C.textMuted, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Auto-refresh (10s)
            </label>
            {autoRefresh && (
              <span style={{ fontSize: '0.75rem', color: C.green, fontWeight: 500 }}>● attivo</span>
            )}
          </div>

          {runsLoading && (
            <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>Caricamento run...</p>
          )}

          {runsError && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: '8px', padding: '12px 14px', fontSize: '0.84rem', color: '#78350f' }}>
              ⚠ {runsError}
            </div>
          )}

          {!runsLoading && !runsError && runs.length === 0 && (
            <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>Nessuna run trovata per questo agente.</p>
          )}

          {!runsLoading && !runsError && runs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {runs.map(run => {
                const isExpanded = expandedRunId === run.id
                const statusEmoji = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳'
                const statusColor = run.status === 'completed' ? C.green : run.status === 'failed' ? C.red : C.yellow
                const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0)

                return (
                  <div
                    key={run.id}
                    style={{
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 120px 70px 90px 90px 1fr',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {/* Status */}
                      <span style={{ fontSize: '0.9rem' }}>{statusEmoji}</span>

                      {/* Time */}
                      <span style={{ fontSize: '0.75rem', color: C.textMuted, fontFamily: 'monospace' }}>
                        {formatRunTime(run.created_at)}
                      </span>

                      {/* Duration */}
                      <span style={{ fontSize: '0.75rem', color: C.textFaint, fontFamily: 'monospace' }}>
                        {formatDuration(run.duration_ms)}
                      </span>

                      {/* Tokens */}
                      <span style={{ fontSize: '0.75rem', color: C.textFaint }}>
                        {formatTokens(totalTokens)}
                        {run.cache_read_tokens > 0 && (
                          <span style={{ marginLeft: '4px', color: C.blue }}>
                            💾 {formatTokens(run.cache_read_tokens)}
                          </span>
                        )}
                      </span>

                      {/* Project ID */}
                      <span style={{ fontSize: '0.72rem', color: C.textFaint, fontFamily: 'monospace' }}>
                        {run.project_id ? '…' + run.project_id.slice(-8) : '—'}
                      </span>

                      {/* Summaries */}
                      <div style={{ minWidth: 0 }}>
                        {run.input_summary && (
                          <p style={{ margin: '0 0 2px', fontSize: '0.78rem', color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ color: C.textFaint, marginRight: '4px' }}>in:</span>
                            {truncate(run.input_summary, 60)}
                          </p>
                        )}
                        {run.output_summary && (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ color: C.textFaint, marginRight: '4px' }}>out:</span>
                            {truncate(run.output_summary, 60)}
                          </p>
                        )}
                        {run.error_message && (
                          <p style={{ margin: 0, fontSize: '0.78rem', color: C.red, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {truncate(run.error_message, 80)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Expanded row */}
                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px', background: C.bg }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div>
                            <p style={{ margin: '0 0 6px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Input Data
                            </p>
                            <pre style={{
                              margin: 0,
                              background: '#1e1e1e',
                              color: '#d4d4d4',
                              borderRadius: '6px',
                              padding: '10px 12px',
                              fontSize: '0.72rem',
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              fontFamily: 'ui-monospace, monospace',
                              maxHeight: '200px',
                              overflowY: 'auto',
                            }}>
                              {run.input_data ? JSON.stringify(run.input_data, null, 2) : 'null'}
                            </pre>
                          </div>
                          <div>
                            <p style={{ margin: '0 0 6px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Output Data
                            </p>
                            <pre style={{
                              margin: 0,
                              background: '#1e1e1e',
                              color: '#d4d4d4',
                              borderRadius: '6px',
                              padding: '10px 12px',
                              fontSize: '0.72rem',
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              fontFamily: 'ui-monospace, monospace',
                              maxHeight: '200px',
                              overflowY: 'auto',
                            }}>
                              {run.output_data ? JSON.stringify(run.output_data, null, 2) : 'null'}
                            </pre>
                          </div>
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', gap: '16px', fontSize: '0.72rem', color: C.textFaint }}>
                          <span>ID: <code style={{ fontFamily: 'monospace' }}>{run.id}</code></span>
                          {run.model && <span>Modello: <code style={{ fontFamily: 'monospace' }}>{shortModel(run.model)}</code></span>}
                          {run.completed_at && <span>Completato: {formatRunTime(run.completed_at)}</span>}
                          <span style={{ color: statusColor, fontWeight: 600 }}>{run.status}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Memoria Progetti */}
      {activeTab === 'memory' && (
        <div style={{ overflowY: 'auto' }}>
          {name !== 'memory' ? (
            <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>
              Questo agente non gestisce memoria di progetto.
            </p>
          ) : (
            <>
              {contextsLoading && (
                <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>Caricamento contesti...</p>
              )}
              {!contextsLoading && projectContexts.length === 0 && (
                <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>Nessun progetto con dati di contesto.</p>
              )}
              {!contextsLoading && projectContexts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {projectContexts.map(proj => {
                    const isExpanded = expandedCtxId === proj.id
                    let parsed: Record<string, unknown> | null = null
                    try {
                      if (proj.context) parsed = JSON.parse(proj.context) as Record<string, unknown>
                    } catch {
                      parsed = null
                    }

                    const contextFields: Array<{ key: string; label: string }> = [
                      { key: 'businessName', label: 'Business' },
                      { key: 'businessType', label: 'Tipo' },
                      { key: 'targetAudience', label: 'Target' },
                      { key: 'toneOfVoice', label: 'Tono' },
                      { key: 'language', label: 'Lingua' },
                      { key: 'services', label: 'Servizi' },
                    ]

                    const hasFields = parsed && contextFields.some(f => parsed![f.key])

                    return (
                      <div
                        key={proj.id}
                        style={{
                          background: C.white,
                          border: `1px solid ${C.border}`,
                          borderRadius: '8px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          onClick={() => setExpandedCtxId(isExpanded ? null : proj.id)}
                          style={{ padding: '12px 14px', cursor: 'pointer', userSelect: 'none' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <div>
                              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: C.text }}>{proj.name}</span>
                              <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: C.textFaint, fontFamily: 'monospace' }}>/{proj.slug}</span>
                            </div>
                            <span style={{ fontSize: '0.72rem', color: C.textFaint }}>{isExpanded ? '▲' : '▼'}</span>
                          </div>

                          {hasFields ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {contextFields.map(f => {
                                const val = parsed?.[f.key]
                                if (!val) return null
                                return (
                                  <span key={f.key} style={{
                                    fontSize: '0.72rem',
                                    background: C.bg,
                                    border: `1px solid ${C.border}`,
                                    borderRadius: '4px',
                                    padding: '2px 8px',
                                    color: C.textMuted,
                                  }}>
                                    <span style={{ color: C.textFaint, marginRight: '3px' }}>{f.label}:</span>
                                    {Array.isArray(val) ? (val as unknown[]).join(', ') : String(val)}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.78rem', color: C.textFaint, fontStyle: 'italic' }}>Nessun dato</span>
                          )}
                        </div>

                        {isExpanded && (
                          <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px', background: C.bg }}>
                            <p style={{ margin: '0 0 6px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              JSON completo
                            </p>
                            <pre style={{
                              margin: 0,
                              background: '#1e1e1e',
                              color: '#d4d4d4',
                              borderRadius: '6px',
                              padding: '10px 12px',
                              fontSize: '0.72rem',
                              lineHeight: 1.5,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              fontFamily: 'ui-monospace, monospace',
                              maxHeight: '300px',
                              overflowY: 'auto',
                            }}>
                              {proj.context ?? 'null'}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Statistiche */}
      {activeTab === 'stats' && (
        <div style={{ overflowY: 'auto' }}>
          {statsLoading && (
            <p style={{ color: C.textMuted, fontSize: '0.88rem' }}>Caricamento statistiche...</p>
          )}

          {statsError && (
            <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: '8px', padding: '12px 14px', fontSize: '0.84rem', color: '#78350f' }}>
              ⚠ {statsError}
            </div>
          )}

          {!statsLoading && !statsError && stats && (() => {
            const totalRuns = stats.rows.reduce((s, r) => s + r.count, 0)
            const completedRow = stats.rows.find(r => r.status === 'completed')
            const completedCount = completedRow?.count ?? 0
            const successPct = totalRuns > 0 ? Math.round((completedCount / totalRuns) * 100) : 0

            const allAvgDurs = stats.rows.filter(r => r.avg_duration !== null)
            const avgDur = allAvgDurs.length > 0
              ? allAvgDurs.reduce((s, r) => s + (r.avg_duration ?? 0) * r.count, 0) / allAvgDurs.reduce((s, r) => s + r.count, 0)
              : null

            const totalTokens = stats.rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0)
            const totalCache = stats.rows.reduce((s, r) => s + (r.total_cache ?? 0), 0)
            const cacheHitRate = totalTokens + totalCache > 0
              ? Math.round((totalCache / (totalTokens + totalCache)) * 100)
              : 0

            const statCards = [
              { label: 'Runs totali', value: String(totalRuns) },
              { label: 'Successo', value: `${successPct}%` },
              { label: 'Durata media', value: formatDuration(avgDur) },
              { label: 'Token totali', value: formatTokens(totalTokens) },
              { label: 'Cache hit rate', value: `${cacheHitRate}%` },
              { label: 'Ultime 24h', value: String(stats.last24h) },
              { label: 'Ultimi 7 giorni', value: String(stats.last7d) },
              { label: 'Errori recenti', value: String(stats.rows.find(r => r.status === 'failed')?.count ?? 0) },
            ]

            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
                  {statCards.map(card => (
                    <div
                      key={card.label}
                      style={{
                        background: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: '10px',
                        padding: '14px 16px',
                      }}
                    >
                      <p style={{ margin: '0 0 4px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {card.label}
                      </p>
                      <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>
                        {card.value}
                      </p>
                    </div>
                  ))}
                </div>

                {stats.recentErrors.length > 0 && (
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px' }}>
                    <p style={{ margin: '0 0 10px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Ultimi errori
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {stats.recentErrors.map((err, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 10px',
                            background: '#fff1f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            color: C.red,
                            fontFamily: 'monospace',
                          }}
                        >
                          {err}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-status breakdown */}
                {stats.rows.length > 0 && (
                  <div style={{ marginTop: '16px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px' }}>
                    <p style={{ margin: '0 0 10px', fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Per status
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {stats.rows.map(r => (
                        <div key={r.status} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.82rem' }}>
                          <span style={{ minWidth: '80px', fontWeight: 600, color: r.status === 'completed' ? C.green : r.status === 'failed' ? C.red : C.yellow }}>
                            {r.status}
                          </span>
                          <span style={{ color: C.textMuted }}>{r.count} run</span>
                          {r.avg_duration !== null && (
                            <span style={{ color: C.textFaint }}>avg {formatDuration(r.avg_duration)}</span>
                          )}
                          {r.total_tokens !== null && r.total_tokens > 0 && (
                            <span style={{ color: C.textFaint }}>{formatTokens(r.total_tokens)} tok</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
