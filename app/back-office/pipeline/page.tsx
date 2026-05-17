'use client'

import Link from 'next/link'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
}

// ── Agent node ──────────────────────────────────────────────────────────────

type NodeProps = {
  id: string
  label: string
  model?: string
  optional?: boolean
  note?: string
}

function AgentNode({ id, label, model, optional, note }: NodeProps) {
  return (
    <Link
      href={`/back-office/agents/${id}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '148px', minHeight: '72px',
        background: C.white,
        border: `${optional ? '1.5px dashed #cbd5e1' : `1.5px solid ${C.text}`}`,
        borderRadius: '10px',
        padding: '10px 12px',
        textDecoration: 'none',
        gap: '2px',
        flexShrink: 0,
        transition: 'box-shadow 0.12s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.text, textAlign: 'center', lineHeight: 1.3 }}>
        {label}
      </span>
      {note && (
        <span style={{ fontSize: '0.68rem', color: C.textFaint, textAlign: 'center' }}>{note}</span>
      )}
      {model && (
        <span style={{ fontSize: '0.68rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace', marginTop: '4px' }}>
          {model.replace('claude-', '').replace('-20251001', '')}
        </span>
      )}
    </Link>
  )
}

// ── Arrow ───────────────────────────────────────────────────────────────────

function Arrow() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" style={{ flexShrink: 0 }}>
      <line x1="0" y1="8" x2="20" y2="8" stroke={C.borderStrong} strokeWidth="1.5" />
      <polygon points="20,4 28,8 20,12" fill={C.borderStrong} />
    </svg>
  )
}

// ── Parallel group (vertical stack with bracket) ─────────────────────────────

function ParallelGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '8px',
      padding: '10px 14px',
      border: `1px dashed ${C.border}`,
      borderRadius: '10px',
      background: C.bg,
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute', top: '-9px', left: '12px',
        fontSize: '0.6rem', fontWeight: 600, color: C.textFaint,
        background: C.bg, padding: '0 4px',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        parallelo
      </span>
      {children}
    </div>
  )
}

// ── Workflow card ────────────────────────────────────────────────────────────

type WorkflowCardProps = {
  title: string
  trigger: string
  children: React.ReactNode
}

function WorkflowCard({ title, trigger, children }: WorkflowCardProps) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px 24px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: C.text }}>{title}</h2>
        <span style={{ fontSize: '0.78rem', color: C.textFaint }}>Trigger: <em>{trigger}</em></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Single-agent workflow ────────────────────────────────────────────────────

function SingleAgent(props: NodeProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <AgentNode {...props} />
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Workflow</h1>
      <p style={{ margin: '6px 0 28px', fontSize: '0.88rem', color: C.textMuted }}>
        I 5 flussi di esecuzione degli agenti. Ogni nodo è cliccabile e apre la configurazione dell&apos;agente.
      </p>

      {/* ── 1. Creazione sito ── */}
      <WorkflowCard
        title="1 · Creazione sito"
        trigger="«crea», «genera», «nuovo sito» — o nessun sito esistente"
      >
        <AgentNode id="memory" label="Memory" model="claude-haiku-4-5-20251001" />
        <Arrow />
        <AgentNode id="planner" label="Planner" model="claude-haiku-4-5-20251001" />
        <Arrow />
        <AgentNode id="site-analyzer" label="Site Analyzer" model="claude-haiku-4-5-20251001" optional note="se URL" />
        <Arrow />
        <ParallelGroup>
          <AgentNode id="content" label="Content" model="claude-haiku-4-5-20251001" />
          <AgentNode id="design" label="Design" model="claude-haiku-4-5-20251001" />
        </ParallelGroup>
        <Arrow />
        <AgentNode id="html" label="HTML" model="claude-haiku-4-5-20251001" />
      </WorkflowCard>

      {/* ── 2. Modifica puntuale ── */}
      <WorkflowCard
        title="2 · Modifica puntuale"
        trigger="qualsiasi richiesta generica su sito esistente"
      >
        <SingleAgent id="html" label="HTML" model="claude-haiku-4-5-20251001" />
      </WorkflowCard>

      {/* ── 3. SEO ── */}
      <WorkflowCard
        title="3 · Ottimizzazione SEO"
        trigger="«seo», «meta tag», «sitemap», «robots», «canonical»"
      >
        <SingleAgent id="seo" label="SEO" model="claude-haiku-4-5-20251001" />
      </WorkflowCard>

      {/* ── 4. Aggiorna design ── */}
      <WorkflowCard
        title="4 · Aggiorna Design"
        trigger="«colore», «font», «stile», «tema», «restyle», «più moderno»"
      >
        <SingleAgent id="design" label="Design Update" model="claude-haiku-4-5-20251001" />
      </WorkflowCard>

      {/* ── 5. Aggiorna contenuti ── */}
      <WorkflowCard
        title="5 · Aggiorna Contenuti"
        trigger="«riscrivi», «tono di voce», «più formale», «traduci»"
      >
        <SingleAgent id="content" label="Content Update" model="claude-haiku-4-5-20251001" />
      </WorkflowCard>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', marginTop: '8px', fontSize: '0.78rem', color: C.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1.5px solid ${C.text}`, borderRadius: '3px' }} />
          Step obbligatorio
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: '1.5px dashed #cbd5e1', borderRadius: '3px' }} />
          Step condizionale
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1px dashed ${C.border}`, borderRadius: '3px', background: C.bg }} />
          Esecuzione parallela
        </div>
      </div>
    </div>
  )
}
