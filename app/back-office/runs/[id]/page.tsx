'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import type { AgentRun } from '../../../../lib/agents/run-logger'
import { formatCost } from '../../../../lib/agents/cost'

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

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 12px',
      borderRadius: '99px',
      fontSize: '0.78rem',
      fontWeight: 600,
      background: color + '18',
      color,
    }}>
      {label}
    </span>
  )
}

function formatFull(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '14px 18px',
    }}>
      <p style={{ margin: 0, fontSize: '0.72rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '1.1rem', fontWeight: 600, color: C.text }}>{value}</p>
    </div>
  )
}

function TextBlock({ label, content, isError }: { label: string; content: string | null; isError?: boolean }) {
  if (!content) return null
  return (
    <div style={{ marginBottom: '16px' }}>
      <p style={{ margin: '0 0 6px', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <div style={{
        background: isError ? '#fef2f2' : C.white,
        border: `1px solid ${isError ? '#fca5a5' : C.border}`,
        borderRadius: '8px', padding: '12px 16px',
        fontSize: '0.85rem', color: isError ? C.red : C.text,
        lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  )
}

export default function RunDetailPage() {
  const params = useParams()
  const id = params?.id as string
  const [run, setRun] = useState<AgentRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token ?? ''
        const res = await fetch(`/api/admin/runs/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.status === 404) { setError('Run non trovato.'); return }
        if (!res.ok) throw new Error(await res.text())
        setRun(await res.json() as AgentRun)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: '32px 40px', color: C.textFaint, fontSize: '0.9rem' }}>
        Caricamento...
      </div>
    )
  }

  if (error || !run) {
    return (
      <div style={{ padding: '32px 40px' }}>
        <Link href="/back-office/runs" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none' }}>
          ← Runs
        </Link>
        <div style={{ marginTop: '20px', color: C.red, fontSize: '0.9rem' }}>
          {error || 'Run non trovato.'}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '900px' }}>
      {/* Back */}
      <Link href="/back-office/runs" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '20px' }}>
        ← Runs
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <Badge label={run.agent_type} color={agentColor(run.agent_type)} />
        <Badge label={run.status} color={statusColor(run.status)} />
        <span style={{ fontSize: '0.85rem', color: C.textMuted, marginLeft: '4px' }}>
          {formatFull(run.created_at)}
        </span>
      </div>

      <p style={{ margin: '0 0 24px', fontSize: '0.75rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace' }}>
        ID: {run.id}
      </p>

      {/* Metadata grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '24px' }}>
        <InfoCard label="Model" value={run.model ?? '—'} />
        <InfoCard label="Durata" value={formatDuration(run.duration_ms)} />
        <InfoCard label="Token input" value={formatTokens(run.input_tokens)} />
        <InfoCard label="Token output" value={formatTokens(run.output_tokens)} />
        <InfoCard label="Costo stimato" value={formatCost(run.cost_usd)} />
      </div>

      {/* Input / Output */}
      <TextBlock label="Input" content={run.input_summary} />
      {run.status === 'error'
        ? <TextBlock label="Errore" content={run.error_message} isError />
        : <TextBlock label="Output" content={run.output_summary} />
      }

      {/* Footer meta */}
      <div style={{
        marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${C.border}`,
        display: 'flex', gap: '24px', flexWrap: 'wrap',
      }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.68rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Project ID</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace', color: C.textMuted }}>
            {run.project_id ?? '—'}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '0.68rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>User ID</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace', color: C.textMuted }}>
            {run.user_id ?? '—'}
          </p>
        </div>
        {run.cache_read_tokens > 0 && (
          <div>
            <p style={{ margin: 0, fontSize: '0.68rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Cache read tokens</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace', color: C.textMuted }}>
              {formatTokens(run.cache_read_tokens)}
            </p>
          </div>
        )}
        {run.completed_at && (
          <div>
            <p style={{ margin: 0, fontSize: '0.68rem', color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Completato</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: C.textMuted }}>
              {formatFull(run.completed_at)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
