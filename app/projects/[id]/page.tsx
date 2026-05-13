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
  const [uploading, setUploading] = useState(false)
  const [chatWidth, setChatWidth] = useState(40) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Resizable divider
  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      const pct = (e.clientX / window.innerWidth) * 100
      setChatWidth(Math.max(20, Math.min(80, pct)))
    }
    const handleUp = () => setIsDragging(false)
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  const publicUrl = projectSlug && typeof window !== 'undefined'
    ? `${window.location.origin}/preview/${projectSlug}`
    : ''

  const copyUrl = async () => {
    if (!publicUrl) return
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setUploading(false); return }

    const ext = file.name.split('.').pop() || 'png'
    const path = `${session.user.id}/${id}/${Date.now()}.${ext}`

    const { error } = await supabase.storage
      .from('project-assets')
      .upload(path, file, { contentType: file.type, upsert: false })

    if (error) {
      alert(`Errore upload: ${error.message}`)
      setUploading(false)
      return
    }

    const { data: { publicUrl: imageUrl } } = supabase.storage
      .from('project-assets')
      .getPublicUrl(path)

    setInput(prev => `${prev}${prev ? ' ' : ''}Usa questa immagine: ${imageUrl}`)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Chat panel */}
      <div style={{ width: `${chatWidth}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafaf9' }}>
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1c1917' }}>{projectName || 'Progetto'}</span>
          <a href="/projects" style={{ fontSize: '0.8rem', color: '#78716c', textDecoration: 'none' }}>← Tutti i progetti</a>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#a8a29e', paddingTop: '3rem' }}>
              <p style={{ fontSize: '1.05rem', marginBottom: '0.5rem', color: '#57534e' }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.875rem' }}>Es: &quot;Un sito per il mio ristorante a Milano, elegante e moderno&quot;</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: msg.role === 'user' ? '#0891b2' : '#9333ea',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {msg.role === 'user' ? 'Tu' : 'Assistente'}
              </div>
              <div style={{
                fontSize: '0.9375rem',
                lineHeight: '1.6',
                color: '#1c1917',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.role === 'assistant'
                  ? (stripHtmlFromChat(msg.content) || (loading ? '...' : ''))
                  : msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} style={{ padding: '1rem 1.25rem', borderTop: '1px solid #e7e5e4', display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'white' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || uploading}
            title="Carica immagine"
            style={{ background: 'transparent', color: '#78716c', border: '1px solid #e7e5e4', padding: '0.6rem 0.75rem', fontSize: '1rem', borderRadius: '0.5rem' }}
          >
            {uploading ? '⏳' : '📎'}
          </button>
          <input
            type="text"
            placeholder="Descrivi il tuo sito o chiedi modifiche..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid #e7e5e4', borderRadius: '0.5rem', fontSize: '0.9375rem' }}
          />
          <button type="submit" disabled={loading || !input.trim()} style={{ padding: '0.6rem 1.25rem', borderRadius: '0.5rem' }}>
            {loading ? '...' : 'Invia'}
          </button>
        </form>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={() => setIsDragging(true)}
        style={{
          width: '4px',
          cursor: 'col-resize',
          background: isDragging ? '#2563eb' : '#e7e5e4',
          flexShrink: 0,
          transition: isDragging ? 'none' : 'background 0.15s',
        }}
        onMouseEnter={(e) => { if (!isDragging) (e.target as HTMLElement).style.background = '#a8a29e' }}
        onMouseLeave={(e) => { if (!isDragging) (e.target as HTMLElement).style.background = '#e7e5e4' }}
      />

      {/* Preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', overflow: 'hidden' }}>
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
