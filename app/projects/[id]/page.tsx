'use client'

import { useState, use, useRef, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Page = { slug: string; name: string; html: string }

function stripHtmlFromChat(content: string): string {
  if (!content) return ''
  const codeMatch = content.indexOf('```')
  const htmlTagMatch = content.search(/<[a-zA-Z!]/)
  const candidates = [codeMatch, htmlTagMatch].filter(i => i >= 0)
  const cutAt = candidates.length > 0 ? Math.min(...candidates) : -1
  const prose = cutAt >= 0 ? content.slice(0, cutAt).trim() : content.trim()
  const isComplete = /<\/html>\s*(```)?\s*$/i.test(content) || /```\s*$/.test(content.trim())
  if (cutAt >= 0) {
    const status = isComplete ? '✨ Sito generato' : '✨ Sto generando il sito...'
    return prose ? `${prose}\n\n${status}` : status
  }
  return prose
}

function injectBase(html: string, projectSlug: string): string {
  const baseTag = `<base href="/preview/${projectSlug}/">`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
  }
  return baseTag + html
}

// ---- Design Tokens ----
const C = {
  bg: '#faf9f7',
  bgPanel: '#f4f2ef',
  border: '#e8e4de',
  borderLight: '#f0ede8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  userBubble: '#f0ebe1',
  white: '#ffffff',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  dark: '#1a1a1a',
}

function ToolbarBtn({
  label, active, onClick, title,
}: {
  label: React.ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '5px 10px', borderRadius: '7px', border: 'none',
        background: active ? C.blue : 'transparent',
        color: active ? 'white' : C.textMuted,
        fontSize: '0.78rem', fontWeight: active ? 600 : 400,
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background 0.12s',
        whiteSpace: 'nowrap' as const,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pages, setPages] = useState<Page[]>([])
  const [activeSlug, setActiveSlug] = useState<string>('home')
  const [projectName, setProjectName] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [chatWidth, setChatWidth] = useState(38)
  const [isDragging, setIsDragging] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [customDomain, setCustomDomain] = useState('')
  const [customDomainStatus, setCustomDomainStatus] = useState<string | null>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const [dnsInstructions, setDnsInstructions] = useState<string>('')
  const [verifying, setVerifying] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const verifyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activePage = pages.find(p => p.slug === activeSlug) || pages[0]

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      const pct = (e.clientX / window.innerWidth) * 100
      setChatWidth(Math.max(22, Math.min(75, pct)))
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

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const ROOT_DOMAIN = 'factulista.com'
  const publicBaseUrl = (() => {
    if (!projectSlug || typeof window === 'undefined') return ''
    const host = window.location.host
    const isProduction = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
    return isProduction
      ? `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
      : `${window.location.origin}/preview/${projectSlug}`
  })()
  const publicUrl = publicBaseUrl
    ? (activeSlug === 'home' ? publicBaseUrl : `${publicBaseUrl}/${activeSlug}`)
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
    const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
    if (error) { alert(`Errore upload: ${error.message}`); setUploading(false); return }
    const { data: { publicUrl: imageUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
    setInput(prev => `${prev}${prev ? ' ' : ''}Usa questa immagine: ${imageUrl}`)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    const load = async () => {
      const { data: project } = await supabase
        .from('projects')
        .select('name, slug, site_config, custom_domain, custom_domain_status')
        .eq('id', id)
        .single()
      if (!project) return
      setProjectName(project.name)
      setProjectSlug(project.slug)
      if (project.custom_domain) {
        setCustomDomain(project.custom_domain)
        setCustomDomainStatus(project.custom_domain_status)
      }
      const config = project.site_config as { html?: string; pages?: Page[]; messages?: Message[] } | null
      let loadedPages: Page[] = []
      if (config?.pages?.length) loadedPages = config.pages
      else if (config?.html) loadedPages = [{ slug: 'home', name: 'Home', html: config.html }]
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) setMessages(config.messages)
    }
    load()
  }, [id])

  const saveState = async (newMessages: Message[], newPages: Page[]) => {
    await supabase.from('projects').update({
      site_config: { pages: newPages, messages: newMessages },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userContent = input
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userContent }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        pages,
        activePageSlug: activeSlug,
        customDomain: customDomainStatus === 'verified' ? customDomain : null,
      }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: `❌ Errore: ${error.error || `HTTP ${res.status}`}` }
        : m))
      setLoading(false)
      return
    }

    // Consuma lo stream newline-delimited JSON
    const reader = res.body?.getReader()
    if (!reader) {
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Errore: Impossibile leggere la risposta' }
        : m))
      setLoading(false)
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: any = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Ultimo elemento (incompleto) rimane nel buffer

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)

            if (msg.type === 'progress') {
              // Mostra il progresso: "✏️ Content Agent... 0m 5s · 1.2k tokens"
              const tokenDisplay = msg.tokens > 1000 ? `${(msg.tokens / 1000).toFixed(1)}k` : msg.tokens
              const progressText = `${msg.step} • ${msg.time} • ${tokenDisplay} tokens`
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, content: progressText }
                : m))
            } else if (msg.type === 'done') {
              result = msg.result
            }
          } catch (e) {
            console.error('Errore parsing messaggio:', e)
          }
        }
      }
    } catch (err) {
      console.error('Errore lettura stream:', err)
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Errore nella comunicazione' }
        : m))
      setLoading(false)
      return
    }

    if (!result) {
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Nessun risultato ricevuto' }
        : m))
      setLoading(false)
      return
    }

    let newPages: Page[] = pages
    let summary = ''
    let newActiveSlug = activeSlug

    if (result.tool === 'create_site') {
      newPages = result.input.pages as Page[]
      const steps = result.steps ? `\n${(result.steps as string[]).join('\n')}` : ''
      summary = `✨ ${result.input.summary}${steps}`
      if (newPages.length > 0) newActiveSlug = newPages[0].slug
    } else if (result.tool === 'edit_page') {
      const targetSlug = result.input.pageSlug as string
      const edits = result.input.edits as { find: string; replace: string }[]
      let skipped = 0
      newPages = pages.map(p => {
        if (p.slug !== targetSlug) return p
        let html = p.html
        for (const edit of edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
          else skipped++
        }
        return { ...p, html }
      })
      summary = `✏️ ${result.input.summary}${skipped ? ` (${skipped} edit non applicate)` : ''}`
      newActiveSlug = targetSlug
    } else if (result.tool === 'add_page') {
      const newPage: Page = { slug: result.input.slug, name: result.input.name, html: result.input.html }
      newPages = [...pages, newPage]
      summary = `➕ ${result.input.summary}`
      newActiveSlug = newPage.slug
    } else if (result.tool === 'delete_page') {
      const targetSlug = result.input.pageSlug as string
      if (targetSlug === 'home') {
        summary = '⚠️ La pagina "home" non può essere eliminata'
      } else {
        newPages = pages.filter(p => p.slug !== targetSlug)
        summary = `🗑 ${result.input.summary}`
        if (activeSlug === targetSlug) newActiveSlug = newPages[0]?.slug || 'home'
      }
    } else if (result.tool === 'update_seo') {
      const seoPages = result.input.pages as { pageSlug: string; edits: { find: string; replace: string }[] }[]
      let skipped = 0
      newPages = pages.map(p => {
        const seoPage = seoPages.find(sp => sp.pageSlug === p.slug)
        if (!seoPage) return p
        let html = p.html
        for (const edit of seoPage.edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
          else skipped++
        }
        return { ...p, html }
      })
      summary = `🔍 ${result.input.summary}${skipped ? ` (${skipped} edit non applicate)` : ''}`
    } else if (result.tool === 'generate_sitemap') {
      summary = `🗺️ ${result.input.summary}`
    }

    setPages(newPages)
    setActiveSlug(newActiveSlug)
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
    const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
    await saveState(finalMessages, newPages)
    setLoading(false)
  }

  const handleDeletePage = async (slug: string) => {
    if (slug === 'home') { alert('La pagina "home" non può essere eliminata'); return }
    if (!confirm(`Eliminare la pagina "${slug}"?`)) return
    const newPages = pages.filter(p => p.slug !== slug)
    setPages(newPages)
    if (activeSlug === slug) setActiveSlug(newPages[0]?.slug || 'home')
    await saveState(messages, newPages)
  }

  const handleAddCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customDomain.trim()) return
    setAddingDomain(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/add-custom-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id, domain: customDomain.trim() }),
      })
      const result = await res.json()
      if (!res.ok) { alert(`Errore: ${result.error}`); setAddingDomain(false); return }
      setCustomDomainStatus(result.status)
      setDnsInstructions(result.message)
      setAddingDomain(false)
      if (result.status === 'pending') startPolling()
    } catch { alert('Errore nella richiesta'); setAddingDomain(false) }
  }

  const startPolling = () => {
    if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current)
    setVerifying(true)
    verifyIntervalRef.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/verify-custom-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ projectId: id }),
        })
        const result = await res.json()
        if (result.status === 'verified') {
          setCustomDomainStatus('verified')
          setVerifying(false)
          clearInterval(verifyIntervalRef.current!)
          verifyIntervalRef.current = null
        }
      } catch { /* ignore */ }
    }, 15000)
  }

  const handlePublish = async () => {
    if (!confirm(`Pubblicare su ${customDomain}?`)) return
    setPublishing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/publish-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id }),
      })
      const result = await res.json()
      if (!res.ok) { alert(`Errore: ${result.error}`); return }
      setPublishedAt(result.publishedAt)
    } catch { alert('Errore nella pubblicazione') }
    finally { setPublishing(false) }
  }

  useEffect(() => {
    if (customDomainStatus === 'pending') startPolling()
    return () => { if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDomainStatus === 'pending'])

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: C.bg }}>

      {/* ── Chat panel ── */}
      <div style={{ width: `${chatWidth}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg, borderRight: `1px solid ${C.border}` }}>

        {/* Chat header */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.bg, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link href="/projects" style={{ textDecoration: 'none', color: C.textFaint, fontSize: '1rem', display: 'flex', alignItems: 'center' }} title="Tutti i progetti">
              ←
            </Link>
            <div>
              <p style={{ margin: 0, fontSize: '0.8375rem', fontWeight: 600, color: C.text, lineHeight: 1.2 }}>{projectName || 'Progetto'}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: C.textFaint, lineHeight: 1.2 }}>Ultima versione salvata</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <ToolbarBtn label="⟳" title="Cronologia" />
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
              <p style={{ fontSize: '0.9375rem', color: '#57534e', marginBottom: '0.4rem', fontWeight: 500 }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.8125rem', color: C.textFaint }}>Es: &quot;Un sito per il mio ristorante a Milano, elegante e moderno&quot;</p>
            </div>
          )}

          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '82%', padding: '10px 14px',
                  background: C.userBubble, color: C.text,
                  borderRadius: '14px', fontSize: '0.9rem', lineHeight: '1.55',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ width: '22px', height: '22px', background: 'linear-gradient(135deg, #ff6b6b, #ffa94d)', borderRadius: '6px', flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'white', fontSize: '0.6rem', fontWeight: 700 }}>F</span>
                </div>
                <div style={{ fontSize: '0.9rem', lineHeight: '1.65', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                  {stripHtmlFromChat(msg.content) || (loading ? (
                    <span style={{ color: C.textFaint, letterSpacing: '0.1em' }}>● ● ●</span>
                  ) : '')}
                </div>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '8px 10px 12px', flexShrink: 0 }}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          <form onSubmit={handleSend}>
            <div style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}>
              <textarea
                ref={textareaRef}
                placeholder="Descrivi il tuo sito o chiedi modifiche..."
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (input.trim() && !loading) handleSend(e as unknown as React.FormEvent)
                  }
                }}
                disabled={loading}
                rows={1}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  fontSize: '0.9rem', padding: '12px 14px 6px',
                  background: 'transparent', color: C.text,
                  resize: 'none', overflow: 'hidden', lineHeight: '1.5',
                  fontFamily: 'inherit', minHeight: '24px', maxHeight: '180px',
                  display: 'block', boxSizing: 'border-box' as const,
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || uploading}
                    style={{
                      background: 'transparent', color: C.textFaint, border: `1px solid ${C.border}`,
                      padding: '4px 9px', fontSize: '0.78rem', borderRadius: '6px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {uploading ? '⏳' : '@ Immagine'}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: input.trim() && !loading ? C.dark : '#d6d3d1',
                    color: 'white', border: 'none',
                    cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                    fontSize: '0.9rem', flexShrink: 0,
                  }}
                  title="Invia"
                >
                  {loading ? '⏳' : '↑'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* ── Resize handle ── */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setIsDragging(true) }}
        style={{
          width: '5px', cursor: 'col-resize', flexShrink: 0, zIndex: 10,
          background: isDragging ? C.blue : 'transparent',
          transition: isDragging ? 'none' : 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = C.border }}
        onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      />
      {isDragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 9999 }} />}

      {/* ── Preview panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bgPanel, overflow: 'hidden', minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderBottom: `1px solid ${C.border}`,
          background: C.bg, flexShrink: 0, gap: '8px',
        }}>
          {/* Left tools */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <ToolbarBtn label="⟳" title="Cronologia" />
            <ToolbarBtn label="⊡" title="Layout" />
            <div style={{ width: '1px', height: '16px', background: C.border, margin: '0 4px' }} />
            <ToolbarBtn label="◉ Preview" active />
            <ToolbarBtn label="</> Codice" />
            <ToolbarBtn label="☁ Deploy" />
          </div>

          {/* URL bar */}
          <div style={{
            flex: 1, maxWidth: '340px',
            display: 'flex', alignItems: 'center', gap: '6px',
            background: C.white, border: `1px solid ${C.border}`,
            borderRadius: '7px', padding: '4px 8px',
          }}>
            <span style={{ fontSize: '0.75rem', color: C.textFaint }}>□</span>
            {publicUrl ? (
              <a
                href={publicUrl} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, fontSize: '0.75rem', color: C.text, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}
              >
                {publicUrl.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              <span style={{ flex: 1, fontSize: '0.75rem', color: C.textFaint }}>—</span>
            )}
            {publicUrl && (
              <button onClick={copyUrl} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: copied ? '#10b981' : C.textFaint, fontSize: '0.75rem', flexShrink: 0 }} title="Copia URL">
                {copied ? '✓' : '⧉'}
              </button>
            )}
          </div>

          {/* Right actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ToolbarBtn label="↗" title="Apri in nuova scheda" />
              </a>
            )}
            <button
              onClick={() => setShowSettingsModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 10px', borderRadius: '7px',
                border: `1px solid ${C.border}`,
                background: C.white, color: C.text,
                fontSize: '0.78rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ⚙ Impostazioni
            </button>
            {customDomainStatus === 'verified' && (
              <button
                onClick={handlePublish}
                disabled={publishing || pages.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 14px', borderRadius: '7px',
                  background: publishing ? '#93c5fd' : C.blue,
                  color: 'white', border: 'none',
                  fontSize: '0.78rem', fontWeight: 600,
                  cursor: publishing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {publishing ? '⏳' : '🚀'} Pubblica
              </button>
            )}
          </div>
        </div>

        {/* Page tabs */}
        {pages.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '6px 10px', borderBottom: `1px solid ${C.border}`, background: C.bg, overflowX: 'auto', flexShrink: 0 }}>
            {pages.map(p => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveSlug(p.slug)}
                  style={{
                    padding: '4px 12px', borderRadius: '6px', fontSize: '0.78rem', whiteSpace: 'nowrap',
                    background: p.slug === activeSlug ? C.white : 'transparent',
                    color: p.slug === activeSlug ? C.text : C.textMuted,
                    border: p.slug === activeSlug ? `1px solid ${C.border}` : '1px solid transparent',
                    fontWeight: p.slug === activeSlug ? 600 : 400,
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: p.slug === activeSlug ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  {p.name}
                </button>
                {p.slug !== 'home' && p.slug === activeSlug && (
                  <button
                    onClick={() => handleDeletePage(p.slug)}
                    style={{ background: 'transparent', color: '#ef4444', border: 'none', padding: '2px 5px', fontSize: '0.85rem', cursor: 'pointer' }}
                    title="Elimina pagina"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* iframe */}
        {activePage ? (
          <iframe
            srcDoc={injectBase(activePage.html, projectSlug)}
            style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
            title="Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textFaint, flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '2rem', opacity: 0.3 }}>◉</div>
            <p style={{ fontSize: '0.875rem' }}>La preview apparirà qui dopo che l&apos;AI genera il sito</p>
          </div>
        )}
      </div>

      {/* ── Settings Modal ── */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: C.white, borderRadius: '14px', padding: '1.75rem', maxWidth: '480px', width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: C.text }}>Impostazioni Progetto</h2>
              <button onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
                style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: C.textFaint, padding: '2px 6px' }}>×</button>
            </div>

            {/* Staging domain */}
            <div style={{ marginBottom: '1.25rem', padding: '12px 14px', background: C.bg, borderRadius: '10px', border: `1px solid ${C.border}` }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: C.textFaint, fontWeight: 500 }}>Dominio di preview (staging)</p>
              <p style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>myweb.factulista.com/{projectSlug}</p>
            </div>

            {customDomainStatus === 'verified' ? (
              <>
                <div style={{ marginBottom: '1rem', padding: '12px 14px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: C.textFaint }}>Dominio personalizzato</p>
                  <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>{customDomain}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#059669' }}>✓ Verificato e attivo</p>
                </div>
                <button
                  onClick={handlePublish}
                  disabled={publishing || pages.length === 0}
                  style={{ width: '100%', padding: '10px', background: publishing ? '#93c5fd' : C.blue, color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, fontSize: '0.875rem', cursor: publishing ? 'not-allowed' : 'pointer', marginBottom: '8px', fontFamily: 'inherit' }}>
                  {publishing ? '⏳ Pubblicazione...' : `🚀 Pubblica su ${customDomain}`}
                </button>
                {publishedAt && (
                  <p style={{ margin: '0 0 1rem', fontSize: '0.75rem', color: '#059669', textAlign: 'center' }}>
                    ✓ Pubblicato il {new Date(publishedAt).toLocaleString('it-IT')}
                  </p>
                )}
              </>
            ) : customDomainStatus === 'pending' ? (
              <div style={{ marginBottom: '1rem', padding: '12px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.75rem', color: C.textMuted }}>In attesa di verifica DNS</span>
                  {verifying && <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>● verifica in corso...</span>}
                </div>
                <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>{customDomain}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400e' }}>La verifica è automatica, può richiedere fino a 15 minuti</p>
              </div>
            ) : (
              <form onSubmit={handleAddCustomDomain} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.8125rem', fontWeight: 500, color: C.text }}>
                  Dominio personalizzato (produzione)
                </label>
                <input
                  type="text"
                  placeholder="es: miodominio.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  disabled={addingDomain}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '10px', fontSize: '0.875rem', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none' }}
                />
                <button
                  type="submit"
                  disabled={addingDomain || !customDomain.trim()}
                  style={{ width: '100%', padding: '9px', background: customDomain.trim() && !addingDomain ? C.dark : '#d6d3d1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: customDomain.trim() && !addingDomain ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontFamily: 'inherit' }}>
                  {addingDomain ? '⏳ Configurazione...' : 'Aggiungi dominio'}
                </button>
              </form>
            )}

            {dnsInstructions && (
              <div style={{ padding: '12px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 6px', fontSize: '0.8125rem', fontWeight: 600, color: C.text }}>Configura il tuo DNS:</p>
                <pre style={{ margin: 0, fontSize: '0.75rem', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>{dnsInstructions}</pre>
                <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: C.textMuted }}>La verifica può richiedere fino a 15 minuti.</p>
              </div>
            )}

            <button
              onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
              style={{ width: '100%', padding: '9px', background: C.bgPanel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem' }}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
