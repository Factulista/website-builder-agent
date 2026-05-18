'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { WORKFLOWS, type WorkflowStepDef } from '../../../lib/agents/workflow-registry'
import { AGENTS_MANIFEST } from '../../../lib/agents/manifest'
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function agentLabel(id: string): string {
  return AGENTS_MANIFEST.find(a => a.name === id)?.displayName ?? id
}

function agentModel(id: string): string | undefined {
  const m = AGENTS_MANIFEST.find(a => a.name === id)?.model
  if (!m || m === 'rule-based') return undefined
  return m.replace('claude-', '').replace(/-\d{8}$/, '')
}

// ── Step grouping ─────────────────────────────────────────────────────────────
// Reads WorkflowStepDef[] and produces display groups:
//   single     → one step, rendered with an Arrow before it
//   parallel   → steps linked by parallelWith, wrapped in ParallelGroup
//   conditional → consecutive steps with conditional:true, separated by "o"

type StepGroup =
  | { type: 'single'; step: WorkflowStepDef }
  | { type: 'parallel'; steps: WorkflowStepDef[] }
  | { type: 'conditional'; steps: WorkflowStepDef[] }

function groupSteps(steps: WorkflowStepDef[]): StepGroup[] {
  const groups: StepGroup[] = []
  const done = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (done.has(step.agentId)) continue

    if (step.parallelWith) {
      // Collect all steps in this parallel cluster
      const cluster = steps.filter(s =>
        s.agentId === step.agentId ||
        s.agentId === step.parallelWith ||
        s.parallelWith === step.agentId ||
        (step.parallelWith && s.parallelWith === step.parallelWith)
      )
      cluster.forEach(s => done.add(s.agentId))
      groups.push({ type: 'parallel', steps: cluster })
    } else if (step.conditional) {
      // Collect consecutive conditional steps
      const block: WorkflowStepDef[] = [step]
      done.add(step.agentId)
      for (let j = i + 1; j < steps.length; j++) {
        if (steps[j].conditional && !done.has(steps[j].agentId)) {
          block.push(steps[j])
          done.add(steps[j].agentId)
        } else break
      }
      groups.push({ type: 'conditional', steps: block })
    } else {
      done.add(step.agentId)
      groups.push({ type: 'single', step })
    }
  }

  return groups
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function AgentNode({ step }: { step: WorkflowStepDef }) {
  const id = step.agentId
  return (
    <Link
      href={`/back-office/agents/${id}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '148px', minHeight: '72px',
        background: C.white,
        border: step.optional
          ? '1.5px dashed #cbd5e1'
          : `1.5px solid ${C.text}`,
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
        {agentLabel(id)}
      </span>
      {step.note && (
        <span style={{ fontSize: '0.68rem', color: C.textFaint, textAlign: 'center' }}>{step.note}</span>
      )}
      {agentModel(id) && (
        <span style={{ fontSize: '0.68rem', color: C.textFaint, fontFamily: 'ui-monospace, monospace', marginTop: '4px' }}>
          {agentModel(id)}
        </span>
      )}
    </Link>
  )
}

function Arrow() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" style={{ flexShrink: 0 }}>
      <line x1="0" y1="8" x2="20" y2="8" stroke={C.borderStrong} strokeWidth="1.5" />
      <polygon points="20,4 28,8 20,12" fill={C.borderStrong} />
    </svg>
  )
}

function ParallelGroup({ steps, language }: { steps: WorkflowStepDef[]; language: string }) {
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
        {t('pipeline.parallel_label' as const, language as any)}
      </span>
      {steps.map(s => <AgentNode key={s.agentId} step={s} />)}
    </div>
  )
}

function OrSeparator() {
  return (
    <div style={{
      textAlign: 'center', fontSize: '0.65rem', fontWeight: 700,
      color: C.textFaint, padding: '4px 0', letterSpacing: '0.04em',
    }}>
      o
    </div>
  )
}

// ── Dynamic workflow renderer ─────────────────────────────────────────────────

function WorkflowFlow({ steps, language }: { steps: WorkflowStepDef[]; language: string }) {
  const groups = groupSteps(steps)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '16px' }}>
      {groups.map((group, idx) => {
        const isFirst = idx === 0
        const arrow = !isFirst && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
            <Arrow />
          </div>
        )

        if (group.type === 'single') {
          return (
            <div key={group.step.agentId}>
              {arrow}
              <AgentNode step={group.step} />
            </div>
          )
        }

        if (group.type === 'parallel') {
          return (
            <div key={group.steps.map(s => s.agentId).join('-')}>
              {arrow}
              <ParallelGroup steps={group.steps} language={language} />
            </div>
          )
        }

        // conditional — stack with "o" separator
        return (
          <div key={group.steps.map(s => s.agentId).join('-')}>
            {arrow}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0' }}>
              {group.steps.map((s, i) => (
                <div key={s.agentId}>
                  {i > 0 && <OrSeparator />}
                  <AgentNode step={s} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const { language } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedWorkflowId = searchParams.get('workflow') || WORKFLOWS[0].id
  const selectedWorkflow = WORKFLOWS.find(w => w.id === selectedWorkflowId)
  if (!selectedWorkflow) return null

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1100px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>
        {t('pipeline.title' as const, language as any)}
      </h1>
      <p style={{ margin: '6px 0 20px', fontSize: '0.88rem', color: C.textMuted }}>
        {t('pipeline.description' as const, language as any)}
      </p>

      {/* Workflow selector */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{
          display: 'block', fontSize: '0.75rem', fontWeight: 600,
          color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px',
        }}>
          {t('pipeline.selectWorkflow' as const, language as any)}
        </label>
        <select
          value={selectedWorkflowId}
          onChange={e => router.push(`/back-office/pipeline?workflow=${e.target.value}`)}
          style={{
            padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: '8px',
            background: C.white, color: C.text, fontSize: '0.9rem', fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit', minWidth: '280px',
          }}
        >
          {WORKFLOWS.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {/* Workflow card */}
      <div style={{
        background: C.white, border: `1px solid ${C.border}`,
        borderRadius: '12px', padding: '24px', marginBottom: '24px',
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 700, color: C.text }}>
          {selectedWorkflow.name}
        </h2>
        <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: C.textMuted }}>
          {t('pipeline.triggerLabel' as const, language as any)}: <em>{selectedWorkflow.trigger}</em>
        </p>
        <p style={{ margin: '0 0 0', fontSize: '0.78rem', color: C.textFaint }}>
          {selectedWorkflow.steps.length} agenti · aggiornato da <code style={{ fontSize: '0.75rem' }}>lib/agents/workflow-registry.ts</code>
        </p>

        {/* Dynamic flow — generated from WORKFLOWS registry */}
        <WorkflowFlow steps={selectedWorkflow.steps} language={language} />
      </div>

      {/* Steps detail table */}
      <div style={{
        background: C.white, border: `1px solid ${C.border}`,
        borderRadius: '12px', overflow: 'hidden', marginBottom: '24px',
      }}>
        <div style={{
          padding: '12px 20px', borderBottom: `1px solid ${C.border}`,
          fontSize: '0.72rem', fontWeight: 600, color: C.textFaint,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Steps · {selectedWorkflow.name}
        </div>
        {selectedWorkflow.steps.map((step, idx) => (
          <Link
            key={step.agentId}
            href={`/back-office/agents/${step.agentId}`}
            style={{
              display: 'grid', gridTemplateColumns: '24px 1fr 120px 180px',
              gap: '0 16px', alignItems: 'center',
              padding: '10px 20px', textDecoration: 'none', color: 'inherit',
              borderBottom: idx < selectedWorkflow.steps.length - 1 ? `1px solid ${C.border}` : 'none',
              background: C.white,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = C.white}
          >
            <span style={{ fontSize: '0.72rem', color: C.textFaint, fontFamily: 'monospace' }}>
              {idx + 1}
            </span>
            <div>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: C.text }}>
                {agentLabel(step.agentId)}
              </span>
              {step.note && (
                <span style={{ fontSize: '0.78rem', color: C.textMuted, marginLeft: '8px' }}>
                  — {step.note}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {step.optional && (
                <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '99px', background: '#f1f5f9', color: C.textMuted }}>
                  opzionale
                </span>
              )}
              {step.conditional && (
                <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '99px', background: '#fef9c3', color: '#a16207' }}>
                  alternativo
                </span>
              )}
              {step.parallelWith && (
                <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '99px', background: '#ede9fe', color: '#6d28d9' }}>
                  parallelo
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.72rem', color: C.textFaint, fontFamily: 'monospace' }}>
              {agentModel(step.agentId) ?? 'rule-based'}
            </span>
          </Link>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', fontSize: '0.78rem', color: C.textMuted, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1.5px solid ${C.text}`, borderRadius: '3px' }} />
          {t('pipeline.required' as const, language as any)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: '1.5px dashed #cbd5e1', borderRadius: '3px' }} />
          {t('pipeline.optional' as const, language as any)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '22px', height: '14px', border: `1px dashed ${C.border}`, borderRadius: '3px', background: C.bg }} />
          {t('pipeline.parallel' as const, language as any)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textFaint }}>o</span>
          {t('pipeline.alternative' as const, language as any)}
        </div>
      </div>
    </div>
  )
}
