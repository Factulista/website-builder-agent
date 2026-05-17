'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import type { AgentRun } from '../../../lib/agents/run-logger'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#f59e0b',
  blue: '#2563eb',
  purple: '#7c3aed',
  orange: '#ea580c',
  teal: '#0d9488',
}

type Stats = {
  byDay: Array<{ date: string; success: number; error: number; total: number }>
  totals: { success: number; error: number; running: number; total: number }
  tokens: { input: number; output: number; cache_read: number }
  avgDuration: number | null
}

const AGENT_TYPES = ['pipeline', 'html', 'seo', 'design-update', 'content-update']
const STATUSES = ['success', 'error', 'running']
const PAGE_SIZE = 50

const IT_DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

function agentColor(type: string): string {
  switch (type) {
    case 'pipeline': return C.blue
    case 'html': return C.purple
    case 'seo': return C.green
    case 'design-update': return C.orange
    case 'content-update': return C.teal
    default: return C.textMuted
  }
}

function statusColor(status: string): string {
  if (status === 'success') return C.green
  if (status === 'error') return C.red
  return C.yellow
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${min}`
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '99px',
      fontSize: '0.72rem',
      fontWeight: 600,
      background: color + '18',
      color,
      letterSpacing: '0.01em',
    }}>
      {label}
    </span>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '14px 18px', flex: 1, minWidth: 0,
    }}>
      <p style={{ margin: 0, fontSize: '0.72rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '1.5rem', fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: C.textMuted }}>{sub}</p>}
    </div>
  )
}

function BarChart({ byDay }: { byDay: Stats['byDay'] }) {
  const maxVal = Math.max(...byDay.map(d => d.total), 1)
  const chartH = 120
  const chartW = 560
  const barGroupW = chartW / byDay.length
  const barW = Math.min(16, barGroupW * 0.35)
  const gap = 3

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + 28}`} style={{ display: 'block', minWidth: '320px' }}>
        {byDay.map((day, i) => {
          const x = i * barGroupW + barGroupW / 2
          const successH = (day.success / maxVal) * chartH
          const errorH = (day.error / maxVal) * chartH
          const d = new Date(day.date + 'T12:00:00')
          const label = IT_DAY_ABBR[d.getDay()]

          return (
            <g key={day.date}>
              {/* Success bar */}
              <rect
                x={x - barW - gap / 2}
                y={chartH - successH}
                width={barW}
                height={successH || 1}
                rx={3}
                fill={C.green}
                opacity={0.85}
              />
              {/* Error bar */}
              <rect
                x={x + gap / 2}
                y={chartH - errorH}
                width={barW}
                height={errorH || 1}
                rx={3}
                fill={C.red}
                opacity={0.75}
              />
              {/* Label */}
              <text
                x={x}
                y={chartH + 18}
                textAnchor="middle"
                fontSize="10"
                fill={C.textFaint}
                fontFamily="inherit"
              >
                {label}
              </text>
              {/* Date MM/DD */}
              <text
                x={x}
                y={chartH + 28}
                textAnchor="middle"
                fontSize="9"
                fill={C.textFaint}
                fontFamily="inherit"
                opacity={0.7}
              >
                {day.date.slice(5).replace('-', '/')}
              </text>
            </g>
          )
        })}
        {/* Baseline */}
        <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={C.border} strokeWidth={1} />
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '0.72rem', color: C.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: C.green }} />
          Success
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: C.red }} />
          Error
        </div>
      </div>
    </div>
  )
}

export default function RunsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [error, setError] = useState('')

  const [filterAgent, setFilterAgent] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [page, setPage] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getToken = useCallback(async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const token = await getToken()
      const res = await fetch('/api/admin/runs/stats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      setStats(await res.json() as Stats)
    } catch (e) {
      console.error('Stats fetch error:', e)
    } finally {
      setStatsLoading(false)
    }
  }, [getToken])

  const fetchRuns = useCallback(async (
    agent: string,
    status: string,
    from: string,
    to: string,
    pageNum: number
  ) => {
    setLoading(true)
    setError('')
    try {
      const token = await getToken()
      const params = new URLSearchParams()
      if (agent) params.set('agent_type', agent)
      if (status) params.set('status', status)
      if (from) params.set('from_date', from)
      if (to) params.set('to_date', to + 'T23:59:59Z')
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageNum * PAGE_SIZE))

      const res = await fetch(`/api/admin/runs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json() as { runs: AgentRun[]; total: number }
      setRuns(data.runs)
      setTotal(data.total)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [getToken])

  // Initial load
  useEffect(() => {
    fetchStats()
    fetchRuns('', '', '', '', 0)
  }, [fetchStats, fetchRuns])

  // Debounced filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(0)
      fetchRuns(filterAgent, filterStatus, filterFrom, filterTo, 0)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [filterAgent, filterStatus, filterFrom, filterTo, fetchRuns])

  // Page change
  useEffect(() => {
    fetchRuns(filterAgent, filterStatus, filterFrom, filterTo, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const resetFilters = () => {
    setFilterAgent('')
    setFilterStatus('')
    setFilterFrom('')
    setFilterTo('')
    setPage(0)
  }

  const successRate = stats
    ? stats.totals.total > 0
      ? Math.round((stats.totals.success / stats.totals.total) * 100)
      : 0
    : null

  const totalTokens = stats
    ? stats.tokens.input + stats.tokens.output + stats.tokens.cache_read
    : null

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${C.border}`,
    background: C.white,
    color: C.text,
    fontSize: '0.82rem',
    cursor: 'pointer',
    outline: 'none',
  }

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
    fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Runs</h1>
      <p style={{ margin: '6px 0 24px', fontSize: '0.88rem', color: C.textMuted }}>
        Osservabilità completa di ogni esecuzione degli agenti AI.
      </p>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <MetricCard
          label="Totale runs"
          value={statsLoading ? '...' : String(stats?.totals.total ?? 0)}
          sub={statsLoading ? '' : `${stats?.totals.running ?? 0} in corso`}
        />
        <MetricCard
          label="Success rate"
          value={statsLoading ? '...' : `${successRate ?? 0}%`}
          sub={statsLoading ? '' : `${stats?.totals.success ?? 0} ok / ${stats?.totals.error ?? 0} errori`}
        />
        <MetricCard
          label="Durata media"
          value={statsLoading ? '...' : formatDuration(stats?.avgDuration ?? null)}
        />
        <MetricCard
          label="Token totali"
          value={statsLoading ? '...' : formatTokens(totalTokens ?? 0)}
          sub={statsLoading ? '' : `in: ${formatTokens(stats?.tokens.input ?? 0)} / out: ${formatTokens(stats?.tokens.output ?? 0)}`}
        />
      </div>

      {/* Chart */}
      {!statsLoading && stats && stats.byDay.length > 0 && (
        <div style={{
          background: C.white, border: `1px solid ${C.border}`,
          borderRadius: '10px', padding: '16px 20px', marginBottom: '20px',
        }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.78rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Ultimi 7 giorni
          </p>
          <BarChart byDay={stats.byDay} />
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: C.white, border: `1px solid ${C.border}`,
        borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
        display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
      }}>
        <select
          style={selectStyle}
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
        >
          <option value="">Tutti i tipi</option>
          {AGENT_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          style={selectStyle}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">Tutti gli stati</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.78rem', color: C.textMuted }}>Dal</span>
          <input
            type="date"
            style={inputStyle}
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.78rem', color: C.textMuted }}>Al</span>
          <input
            type="date"
            style={inputStyle}
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
          />
        </div>

        {(filterAgent || filterStatus || filterFrom || filterTo) && (
          <button
            onClick={resetFilters}
            style={{
              padding: '6px 12px', borderRadius: '6px',
              border: `1px solid ${C.border}`, background: C.bg,
              color: C.textMuted, fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: C.textFaint }}>
          {total} risultati
        </span>
      </div>

      {/* Table */}
      {error && (
        <div style={{ background: '#fef2f2', border: `1px solid #fca5a5`, borderRadius: '8px', padding: '10px 14px', color: C.red, fontSize: '0.85rem', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['Data', 'Tipo', 'Progetto', 'Stato', 'Tokens', 'Durata', ''].map(h => (
                <th key={h} style={{
                  padding: '10px 14px', textAlign: 'left',
                  fontSize: '0.72rem', fontWeight: 600, color: C.textFaint,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: C.textFaint }}>
                  Caricamento...
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: C.textFaint }}>
                  Nessun run trovato.
                </td>
              </tr>
            ) : (
              runs.map((run, idx) => (
                <tr
                  key={run.id}
                  style={{
                    borderBottom: idx < runs.length - 1 ? `1px solid ${C.border}` : 'none',
                  }}
                >
                  <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDate(run.created_at)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <Badge label={run.agent_type} color={agentColor(run.agent_type)} />
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                    {run.project_id ? run.project_id.slice(0, 8) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <Badge label={run.status} color={statusColor(run.status)} />
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTokens(run.input_tokens + run.output_tokens)}
                  </td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDuration(run.duration_ms)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <Link
                      href={`/back-office/runs/${run.id}`}
                      style={{ color: C.textMuted, textDecoration: 'none', fontSize: '1rem', display: 'inline-block', lineHeight: 1 }}
                    >
                      →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '0.82rem', color: C.textMuted }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} di {total}
          </span>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '6px 12px', borderRadius: '6px',
              border: `1px solid ${C.border}`, background: page === 0 ? C.bg : C.white,
              color: page === 0 ? C.textFaint : C.text,
              fontSize: '0.82rem', cursor: page === 0 ? 'default' : 'pointer',
            }}
          >
            ← Prec
          </button>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            style={{
              padding: '6px 12px', borderRadius: '6px',
              border: `1px solid ${C.border}`,
              background: (page + 1) * PAGE_SIZE >= total ? C.bg : C.white,
              color: (page + 1) * PAGE_SIZE >= total ? C.textFaint : C.text,
              fontSize: '0.82rem', cursor: (page + 1) * PAGE_SIZE >= total ? 'default' : 'pointer',
            }}
          >
            Succ →
          </button>
        </div>
      )}
    </div>
  )
}
