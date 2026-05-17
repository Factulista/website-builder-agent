'use client'

import Link from 'next/link'
import { WORKFLOWS } from '../../../lib/agents/workflow-registry'

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
  conditional?: boolean
  note?: string
}

function AgentNode({ id, label, model, optional, conditional, note }: NodeProps) {
  const isDashed = optional || conditional
  return (
    <Link
      href={`/back-office/agents/${id}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '148px', minHeight: '72px',
        background: C.white,
        border: `${isDashed ? '1.5px dashed #cbd5e1' : `1.5px solid ${C.text}`}`,
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

// ── Conditional group (vertical stack, dashed border, "o" separator) ─────────

function ConditionalGroup({ children }: { children: React.ReactNode }) {
  const nodes = Array.isArray(children) ? children : [children]
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0',
      padding: '10px 14px',
      border: `1.5px dashed #cbd5e1`,
      borderRadius: '10px',
      background: C.white,
      position: 'relative',
    }}>
      <span style={{
        position: 'absolute', top: '-9px', left: '12px',
        fontSize: '0.6rem', fontWeight: 600, color: C.textFaint,
        background: C.white, padding: '0 4px',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        alternativo
      </span>
      {nodes.map((child, i) => (
        <div key={i}>
          {child}
          {i < nodes.length - 1 && (
            <div style={{
              textAlign: 'center',
              fontSize: '0.65rem', fontWeight: 700,
              color: C.textFaint,
              padding: '4px 0',
              letterSpacing: '0.04em',
            }}>
              o
            </div>
          )}
        </div>
      ))}
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

// Agent id → display label mapping (for pipeline card)
const AGENT_LABELS: Record<string, string> = {
  memory: 'Memory',
  planner: 'Planner',
  'site-analyzer': 'Site Analyzer',
  content: 'Content',
  design: 'Design',
  html: 'HTML',
  'html-template': 'HTML Template',
  seo: 'SEO',
  images: 'Images',
}

const AGENT_MODEL = 'claude-haiku-4-5-20251001'

// ── Page ────────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  // Derive orchestrator workflow list from WORKFLOWS for the header block
  const workflowList = WORKFLOWS.map((w, i) => ({
    num: String(i + 1),
    label: w.name.replace(/^\d+ · /, ''),
    trigger: w.trigger.replace(/«|»/g, '').replace(/^\"|\"$/g, ''),
  }))

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Workflow</h1>
      <p style={{ margin: '6px 0 28px', fontSize: '0.88rem', color: C.textMuted }}>
        I 5 flussi di esecuzione degli agenti. Ogni nodo è cliccabile e apre la configurazione dell&apos;agente.
      </p>

      {/* ── Orchestrator (entry point) ── */}
      <div style={{
        display: 'flex', alignItems: 'stretch', gap: '0',
        background: C.white, border: `1px solid ${C.border}`,
        borderRadius: '12px', marginBottom: '16px', overflow: 'hidden',
      }}>
        {/* Left: orchestrator node */}
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          padding: '20px 28px', borderRight: `1px solid ${C.border}`, gap: '6px', minWidth: '200px',
        }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '2px' }}>Ingresso</span>
          <Link href="/back-office/agents/orchestrator" style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              padding: '12px 20px', borderRadius: '10px',
              border: `2px solid ${C.text}`, background: C.text,
              transition: 'opacity 0.12s', cursor: 'pointer',
            }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: C.white }}>Orchestrator</span>
              <span style={{ fontSize: '0.68rem', color: '#9ca3af', fontFamily: 'ui-monospace, monospace' }}>rule-based</span>
            </div>
          </Link>
          <span style={{ fontSize: '0.72rem', color: C.textFaint, textAlign: 'center', maxWidth: '160px' }}>
            Classifica intent e instrada al workflow corretto
          </span>
        </div>

        {/* Arrow */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }}>
          <Arrow />
        </div>

        {/* Right: workflow labels derived from WORKFLOWS */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '16px 20px', gap: '8px' }}>
          {workflowList.map(w => (
            <div key={w.num} style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, width: '16px', flexShrink: 0 }}>{w.num}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.text }}>{w.label}</span>
              <span style={{ fontSize: '0.75rem', color: C.textFaint }}>— {w.trigger}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 1. Creazione sito (pipeline) — rendered manually for complex layout ── */}
      <WorkflowCard
        title={WORKFLOWS[0].name}
        trigger={WORKFLOWS[0].trigger}
      >
        <AgentNode id="memory" label={AGENT_LABELS['memory']} model={AGENT_MODEL} />
        <Arrow />
        <AgentNode id="planner" label={AGENT_LABELS['planner']} model={AGENT_MODEL} />
        <Arrow />
        <AgentNode id="site-analyzer" label={AGENT_LABELS['site-analyzer']} model={AGENT_MODEL} optional note="se URL" />
        <Arrow />
        <ParallelGroup>
          <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} />
          <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} />
        </ParallelGroup>
        <Arrow />
        <ConditionalGroup>
          <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} conditional note="senza template" />
          <AgentNode id="html-template" label={AGENT_LABELS['html-template']} model={AGENT_MODEL} conditional note="con template business" />
        </ConditionalGroup>
      </WorkflowCard>

      {/* ── 2. Modifica sito (tutti i branch condizionali) ── */}
      <WorkflowCard
        title={WORKFLOWS[1].name}
        trigger={WORKFLOWS[1].trigger}
      >
        <ConditionalGroup>
          <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} conditional note="modifica HTML/struttura" />
          <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} conditional note="aggiorna design" />
          <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} conditional note="aggiorna contenuti" />
          <AgentNode id="seo" label={AGENT_LABELS['seo']} model={AGENT_MODEL} conditional note="ottimizzazione SEO" />

          {/* Images branch with triggered subagents */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <AgentNode id="images" label={AGENT_LABELS['images']} model={AGENT_MODEL} conditional note="crea/modifica" />
              <Arrow />
              <ParallelGroup>
                <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} note="layout" />
                <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} note="markup" />
                <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} note="alt text" />
                <AgentNode id="seo" label={AGENT_LABELS['seo']} model={AGENT_MODEL} note="metadata" />
              </ParallelGroup>
            </div>
          </div>
        </ConditionalGroup>
      </WorkflowCard>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', marginTop: '8px', fontSize: '0.78rem', color: C.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1.5px solid ${C.text}`, borderRadius: '3px' }} />
          Step obbligatorio
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: '1.5px dashed #cbd5e1', borderRadius: '3px' }} />
          Step condizionale / alternativo
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1px dashed ${C.border}`, borderRadius: '3px', background: C.bg }} />
          Esecuzione parallela
        </div>
      </div>
    </div>
  )
}
