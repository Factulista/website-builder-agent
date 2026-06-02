'use client'

import { use, useEffect, useState, useCallback } from 'react'
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
}

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20251001', label: 'Sonnet 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 ✨' },
  { value: 'claude-opus-4-5-20251001', label: 'Opus 4.5' },
]

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

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

function shortModel(model: string): string {
  const opt = MODEL_OPTIONS.find(o => o.value === model)
  if (opt) return opt.label
  return model.replace('claude-', '').replace('-20251001', '')
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

  useEffect(() => {
    fetchAgent()
    fetchVersions()
  }, [fetchAgent, fetchVersions])

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
            {/* show current value even if not in list (e.g. rule-based) */}
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
  )
}
