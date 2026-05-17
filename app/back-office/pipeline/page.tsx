'use client'

import { useSearchParams, useRouter } from 'next/navigation'
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
  note?: string
}

function AgentNode({ id, label, model, optional, note }: NodeProps) {
  const isDashed = optional
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

// ── Parallel group ──────────────────────────────────────────────────────────

function ParallelGroup({ children }: { children: React.ReactNode }) {
  const childArray = Array.isArray(children) ? children : [children]
  return (
    <div style={{
      display: 'flex', gap: '8px', alignItems: 'stretch',
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
      <div style={{ display: 'flex', gap: '8px' }}>
        {childArray.map((child, i) => (
          <div key={i}>{child}</div>
        ))}
      </div>
    </div>
  )
}

// ── Or separator ────────────────────────────────────────────────────────────

function OrSeparator() {
  return (
    <div style={{
      textAlign: 'center',
      fontSize: '0.65rem', fontWeight: 700,
      color: C.textFaint,
      padding: '4px 0',
      letterSpacing: '0.04em',
    }}>
      o
    </div>
  )
}

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

export default function WorkflowPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedWorkflowId = searchParams.get('workflow') || WORKFLOWS[0].id

  const selectedWorkflow = WORKFLOWS.find(w => w.id === selectedWorkflowId)
  if (!selectedWorkflow) return null

  const handleWorkflowChange = (workflowId: string) => {
    router.push(`/back-office/pipeline?workflow=${workflowId}`)
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Workflow</h1>
      <p style={{ margin: '6px 0 20px', fontSize: '0.88rem', color: C.textMuted }}>
        Visualizza il flusso di esecuzione degli agenti. Ogni nodo è cliccabile e apre la configurazione.
      </p>

      {/* Workflow tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: `1px solid ${C.border}`, paddingBottom: '0' }}>
        {WORKFLOWS.map(w => (
          <button
            key={w.id}
            onClick={() => handleWorkflowChange(w.id)}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: selectedWorkflowId === w.id ? `3px solid ${C.text}` : '3px solid transparent',
              background: 'transparent',
              color: selectedWorkflowId === w.id ? C.text : C.textMuted,
              fontSize: '0.88rem',
              fontWeight: selectedWorkflowId === w.id ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {w.name}
          </button>
        ))}
      </div>

      {/* Workflow details */}
      <div style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 700, color: C.text }}>
          {selectedWorkflow.name}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: C.textMuted }}>
          Trigger: <em>{selectedWorkflow.trigger}</em>
        </p>

        {/* Flow visualization */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '16px' }}>
          {selectedWorkflow.id === 'pipeline' ? (
            <>
              {/* Pipeline workflow */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AgentNode id="memory" label={AGENT_LABELS['memory']} model={AGENT_MODEL} />
                <Arrow />
                <AgentNode id="planner" label={AGENT_LABELS['planner']} model={AGENT_MODEL} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Arrow />
                <AgentNode id="site-analyzer" label={AGENT_LABELS['site-analyzer']} model={AGENT_MODEL} optional note="se URL" />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Arrow />
                <ParallelGroup>
                  <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} />
                  <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} />
                </ParallelGroup>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Arrow />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} note="senza template" />
                  <OrSeparator />
                  <AgentNode id="html-template" label={AGENT_LABELS['html-template']} model={AGENT_MODEL} note="con template" />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Modify site workflow */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} note="modifica struttura" />
                <OrSeparator />
                <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} note="aggiorna design" />
                <OrSeparator />
                <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} note="aggiorna contenuti" />
                <OrSeparator />
                <AgentNode id="seo" label={AGENT_LABELS['seo']} model={AGENT_MODEL} note="ottimizzazione SEO" />
                <OrSeparator />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <AgentNode id="images" label={AGENT_LABELS['images']} model={AGENT_MODEL} note="crea/modifica" />
                  <Arrow />
                  <ParallelGroup>
                    <AgentNode id="design" label={AGENT_LABELS['design']} model={AGENT_MODEL} note="layout" />
                    <AgentNode id="html" label={AGENT_LABELS['html']} model={AGENT_MODEL} note="markup" />
                    <AgentNode id="content" label={AGENT_LABELS['content']} model={AGENT_MODEL} note="alt text" />
                    <AgentNode id="seo" label={AGENT_LABELS['seo']} model={AGENT_MODEL} note="metadata" />
                  </ParallelGroup>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', fontSize: '0.78rem', color: C.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1.5px solid ${C.text}`, borderRadius: '3px' }} />
          Step obbligatorio
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: '1.5px dashed #cbd5e1', borderRadius: '3px' }} />
          Step condizionale / opzionale
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1px dashed ${C.border}`, borderRadius: '3px', background: C.bg }} />
          Esecuzione parallela
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textFaint }}>o</span>
          Branch alternativo
        </div>
      </div>
    </div>
  )
}
