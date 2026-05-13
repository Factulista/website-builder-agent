'use client'

import { useState, use, useRef, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

type Message = { id: string; role: 'user' | 'assistant'; content: string }

function extractHtml(content: string): string | null {
  // Match ```html ... ``` (with or without newlines)
  const codeBlock = content.match(/```html\s*\n?([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()
  // Match raw <!DOCTYPE html> ... </html>
  const rawHtml = content.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
  if (rawHtml) return rawHtml[0]
  return null
}

function stripHtmlFromChat(content: string): string {
  if (!content) return ''

  // Cut at the FIRST occurrence of any of: ``` code fence, < HTML tag, <!-- HTML comment
  const codeMatch = content.indexOf('```')
  const htmlTagMatch = content.search(/<[a-zA-Z!]/)
  const candidates = [codeMatch, htmlTagMatch].filter(i => i >= 0)
  const cutAt = candidates.length > 0 ? Math.min(...candidates) : -1

  const prose = cutAt >= 0 ? content.slice(0, cutAt).trim() : content.trim()

  // Detect if generation is complete
  const isComplete = /<\/html>\s*(```)?\s*$/i.test(content) || /```\s*$/.test(content.trim())

  if (cutAt >= 0) {
    const status = isComplete ? '✨ Sito generato' : '✨ Sto generando il sito...'
    return prose ? `${prose}\n\n${status}` : status
  }

  return prose
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [copied, setCopied] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const publicUrl = projectSlug && typeof window !== 'undefined'
    ? `${window.location.origin}/preview/${projectSlug}`
    : ''

  const copyUrl = async () => {
    if (!publicUrl) return
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load project state on mount
  useEffect(() => {
    const load = async () => {
      const { data: project } = await supabase
        .from('projects')
        .select('name, slug, site_config')
        .eq('id', id)
        .single()
      if (project) {
        setProjectName(project.name)
        setProjectSlug(project.slug)
        const config = project.site_config as { html?: string; messages?: Message[] } | null
        if (config?.html) setPreviewHtml(config.html)
        if (config?.messages) setMessages(config.messages)
      }
    }
    load()
  }, [id])

  const saveState = async (newMessages: Message[], html: string | null) => {
    await supabase
      .from('projects')
      .update({
        site_config: { html, messages: newMessages },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userContent = input
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userContent }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        currentHtml: previewHtml,
      }),
    })

    const result = await res.json()

    if (!res.ok || result.error) {
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: `❌ Errore: ${result.error || `HTTP ${res.status}`}` }
        : m))
      setLoading(false)
      return
    }

    let newHtml: string | null = previewHtml
    let summary = ''

    if (result.tool === 'create_site') {
      newHtml = result.input.html
      summary = `✨ ${result.input.summary}`
      setPreviewHtml(newHtml)
    } else if (result.tool === 'edit_site') {
      const edits = result.input.edits as { find: string; replace: string }[]
      let html = previewHtml || ''
      const skipped: string[] = []
      for (const edit of edits) {
        if (html.includes(edit.find)) {
          html = html.replace(edit.find, edit.replace)
        } else {
          skipped.push(edit.find.slice(0, 40) + '...')
        }
      }
      newHtml = html
      summary = `✏️ ${result.input.summary}${skipped.length ? ` (${skipped.length} edit non applicate)` : ''}`
      setPreviewHtml(newHtml)
    }

    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))

    const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
    await saveState(finalMessages, newHtml)

    setLoading(false)
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh', gap: 0 }}>
      {/* Chat */}
      <div style={{ borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{projectName || 'Progetto'}</span>
          <a href="/projects" style={{ fontSize: '0.8rem', color: '#6b7280', textDecoration: 'none' }}>← Tutti i progetti</a>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '2rem' }}>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.875rem' }}>Es: &quot;Un sito per il mio ristorante a Milano, elegante e moderno&quot;</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                color: msg.role === 'user' ? 'white' : '#1f2937',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.role === 'assistant'
                  ? (stripHtmlFromChat(msg.content) || (loading ? '...' : ''))
                  : msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Descrivi il tuo sito o chiedi modifiche..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            style={{ flex: 1, padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? '...' : 'Invia'}
          </button>
        </form>
      </div>

      {/* Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'white' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.875rem', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          {previewHtml && publicUrl ? (
            <>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#2563eb', textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
              >
                {publicUrl.replace(/^https?:\/\//, '')}
              </a>
              <button
                onClick={copyUrl}
                style={{ background: copied ? '#10b981' : '#2563eb', color: 'white', padding: '0.35rem 0.75rem', fontSize: '0.75rem', borderRadius: '0.25rem' }}
              >
                {copied ? '✓ Copiato' : 'Copia URL'}
              </button>
            </>
          ) : (
            <span>Preview</span>
          )}
        </div>
        {previewHtml ? (
          <iframe
            srcDoc={previewHtml}
            style={{ flex: 1, border: 'none', width: '100%' }}
            title="Preview"
            sandbox="allow-scripts"
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
            La preview apparirà qui dopo che l&apos;AI genera il sito
          </div>
        )}
      </div>
    </main>
  )
}
