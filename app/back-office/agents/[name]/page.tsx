'use client'

import { use } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AGENTS_MANIFEST } from '../../../../lib/agents/manifest'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  green: '#10b981',
}

export default function AgentDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)
  const agent = AGENTS_MANIFEST.find(a => a.name === name)
  if (!agent) return notFound()

  return (
    <div style={{ padding: '32px 40px', maxWidth: '960px' }}>
      <Link
        href="/back-office/agents"
        style={{ fontSize: '0.82rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '12px' }}
      >
        ← Tutti gli agenti
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '6px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: agent.enabled ? C.green : C.textFaint }} />
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>{agent.displayName}</h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: C.textFaint, fontFamily: 'monospace' }}>{agent.name} · {agent.filePath}</p>
        </div>
        <span style={{ fontSize: '0.7rem', padding: '4px 10px', borderRadius: '999px', background: '#e8e4de', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
          {agent.category}
        </span>
      </div>

      <p style={{ margin: '14px 0 24px', fontSize: '0.92rem', color: C.textMuted, lineHeight: 1.6 }}>
        {agent.description}
      </p>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <Stat label="Modello" value={agent.model.replace('claude-', '').replace('-20251001', '') || agent.model} />
        <Stat label="Max tokens" value={agent.maxTokens > 0 ? agent.maxTokens.toLocaleString() : '—'} />
        <Stat label="Status" value={agent.enabled ? 'Attivo' : 'Disattivato'} />
      </div>

      {/* I/O */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
        <Card title="Inputs">
          <ul style={{ margin: 0, padding: '0 0 0 16px', color: C.textMuted, fontSize: '0.85rem', lineHeight: 1.7 }}>
            {agent.inputs.map(i => <li key={i}>{i}</li>)}
          </ul>
        </Card>
        <Card title="Outputs">
          <ul style={{ margin: 0, padding: '0 0 0 16px', color: C.textMuted, fontSize: '0.85rem', lineHeight: 1.7 }}>
            {agent.outputs.map(o => <li key={o}>{o}</li>)}
          </ul>
        </Card>
      </div>

      {/* System prompt */}
      <Card title="System prompt (anteprima)">
        <pre style={{
          margin: 0, padding: '14px 16px', background: '#1e1e1e',
          color: '#d4d4d4', borderRadius: '8px', fontSize: '0.78rem',
          lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          overflowX: 'auto',
        }}>
{agent.systemPromptPreview}
        </pre>
        <p style={{ margin: '10px 0 0', fontSize: '0.76rem', color: C.textFaint }}>
          Prompt completo nel file <span style={{ fontFamily: 'monospace' }}>{agent.filePath}</span>. Editing inline disponibile in Fase 2.
        </p>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px' }}>
      <p style={{ margin: 0, fontSize: '0.66rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '0.92rem', color: C.text, fontWeight: 600, fontFamily: 'monospace' }}>{value}</p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px' }}>
      <p style={{ margin: '0 0 10px', fontSize: '0.7rem', color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</p>
      {children}
    </div>
  )
}
