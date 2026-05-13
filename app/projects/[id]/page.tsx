'use client'

import { useState, use, useRef, useEffect } from 'react'
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

// Inject a <base> tag so relative links between pages resolve to /preview/{slug}/
function injectBase(html: string, projectSlug: string): string {
  const baseTag = `<base href="/preview/${projectSlug}/">`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
  }
  return baseTag + html
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
  const [chatWidth, setChatWidth] = useState(40)
  const [isDragging, setIsDragging] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [customDomain, setCustomDomain] = useState('')
  const [customDomainStatus, setCustomDomainStatus] = useState<string | null>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const [dnsInstructions, setDnsInstructions] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activePage = pages.find(p => p.slug === activeSlug) || pages[0]

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const ROOT_DOMAIN = 'factulista.com'

  // Use subdomain on production (slug.factulista.com), fallback to /preview/slug on vercel.app/localhost
  const publicBaseUrl = (() => {
    if (!projectSlug || typeof window === 'undefined') return ''
    const host = window.location.host
    const isCustomDomain = host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host.endsWith(`.${ROOT_DOMAIN}`)
    if (isCustomDomain) {
      return `${window.location.protocol}//${projectSlug}.${ROOT_DOMAIN}`
    }
    return `${window.location.origin}/preview/${projectSlug}`
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

  // Load project state on mount (with migration from legacy single-html)
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
      if (config?.pages && config.pages.length > 0) {
        loadedPages = config.pages
      } else if (config?.html) {
        loadedPages = [{ slug: 'home', name: 'Home', html: config.html }]
      }
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) setMessages(config.messages)
    }
    load()
  }, [id])

  const saveState = async (newMessages: Message[], newPages: Page[]) => {
    await supabase
      .from('projects')
      .update({
        site_config: { pages: newPages, messages: newMessages },
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
        pages,
        activePageSlug: activeSlug,
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

    let newPages: Page[] = pages
    let summary = ''
    let newActiveSlug = activeSlug

    if (result.tool === 'create_site') {
      newPages = result.input.pages as Page[]
      summary = `✨ ${result.input.summary}`
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
      const newPage: Page = {
        slug: result.input.slug,
        name: result.input.name,
        html: result.input.html,
      }
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId: id,
          domain: customDomain.trim(),
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        alert(`Errore: ${result.error}`)
        setAddingDomain(false)
        return
      }

      setCustomDomainStatus(result.status)
      setDnsInstructions(result.message)
      setAddingDomain(false)
    } catch (error) {
      console.error(error)
      alert('Errore nella richiesta')
      setAddingDomain(false)
    }
  }

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Chat panel */}
      <div style={{ width: `${chatWidth}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#faf9f7' }}>
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #ebe6df', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#faf9f7' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1c1917' }}>{projectName || 'Progetto'}</span>
          <a href="/projects" style={{ fontSize: '0.8rem', color: '#78716c', textDecoration: 'none' }}>← Tutti i progetti</a>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#a8a29e', paddingTop: '3rem' }}>
              <p style={{ fontSize: '1.05rem', marginBottom: '0.5rem', color: '#57534e' }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.875rem' }}>Es: &quot;Un sito per il mio ristorante a Milano, elegante e moderno&quot;</p>
            </div>
          )}
          {messages.map((msg) => (
            msg.role === 'user' ? (
              <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '85%', padding: '0.75rem 1rem', background: '#f0ebe1', color: '#1c1917',
                  borderRadius: '1.25rem', fontSize: '0.9375rem', lineHeight: '1.55',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} style={{
                fontSize: '0.9375rem', lineHeight: '1.65', color: '#1c1917',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: '0.5rem',
              }}>
                {stripHtmlFromChat(msg.content) || (loading ? (
                  <span style={{ color: '#a8a29e' }}>● ● ●</span>
                ) : '')}
              </div>
            )
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} style={{ padding: '0.75rem 1rem 1rem', background: '#faf9f7' }}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          <div style={{
            background: 'white', border: '1px solid #ebe6df', borderRadius: '1.25rem',
            padding: '0.875rem 1rem 0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}>
            <input
              type="text"
              placeholder="Descrivi il tuo sito o chiedi modifiche..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim() && !loading) handleSend(e as unknown as React.FormEvent)
                }
              }}
              disabled={loading}
              style={{ width: '100%', border: 'none', outline: 'none', fontSize: '0.9375rem', padding: 0, background: 'transparent', color: '#1c1917' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploading}
                title="Carica immagine"
                style={{ background: 'transparent', color: '#78716c', border: 'none', padding: '0.35rem 0.5rem', fontSize: '1.05rem', borderRadius: '0.5rem', cursor: 'pointer' }}
              >
                {uploading ? '⏳' : '+'}
              </button>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                style={{
                  padding: '0.4rem 0.65rem', borderRadius: '50%', width: '32px', height: '32px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: input.trim() && !loading ? '#1c1917' : '#d6d3d1',
                  color: 'white', border: 'none',
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontSize: '1rem',
                }}
                title="Invia"
              >
                {loading ? '⏳' : '↑'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setIsDragging(true) }}
        style={{
          width: '8px', cursor: 'col-resize', background: isDragging ? '#2563eb' : '#e7e5e4',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: isDragging ? 'none' : 'background 0.15s', position: 'relative', zIndex: 10,
        }}
        onMouseEnter={(e) => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = '#a8a29e' }}
        onMouseLeave={(e) => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = '#e7e5e4' }}
      >
        <div style={{ width: '2px', height: '32px', background: isDragging ? 'white' : '#78716c', borderRadius: '1px', pointerEvents: 'none' }} />
      </div>

      {isDragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 9999 }} />}

      {/* Preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', overflow: 'hidden' }}>
        {/* Page tabs */}
        {pages.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.25rem',
            padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb',
            background: '#fafaf9', overflowX: 'auto',
          }}>
            {pages.map(p => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveSlug(p.slug)}
                  style={{
                    background: p.slug === activeSlug ? 'white' : 'transparent',
                    color: p.slug === activeSlug ? '#1c1917' : '#78716c',
                    border: p.slug === activeSlug ? '1px solid #e5e7eb' : '1px solid transparent',
                    padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: '0.375rem',
                    fontWeight: p.slug === activeSlug ? 600 : 400, whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </button>
                {p.slug !== 'home' && p.slug === activeSlug && (
                  <button
                    onClick={() => handleDeletePage(p.slug)}
                    title="Elimina pagina"
                    style={{
                      background: 'transparent', color: '#ef4444', border: 'none',
                      padding: '0.25rem 0.4rem', fontSize: '0.8rem', cursor: 'pointer',
                    }}
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* URL bar */}
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.8rem', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            {activePage && publicUrl ? (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: '#2563eb', textDecoration: 'none', fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {publicUrl.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              <span style={{ color: '#9ca3af' }}>Preview</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {activePage && publicUrl && (
              <button onClick={copyUrl}
                style={{ background: copied ? '#10b981' : '#2563eb', color: 'white', padding: '0.3rem 0.65rem', fontSize: '0.7rem', borderRadius: '0.25rem' }}>
                {copied ? '✓ Copiato' : 'Copia URL'}
              </button>
            )}
            <button onClick={() => setShowSettingsModal(true)}
              style={{ background: '#6b7280', color: 'white', padding: '0.3rem 0.65rem', fontSize: '0.7rem', borderRadius: '0.25rem', border: 'none', cursor: 'pointer' }}>
              ⚙️ Impostazioni
            </button>
          </div>
        </div>

        {activePage ? (
          <iframe
            srcDoc={injectBase(activePage.html, projectSlug)}
            style={{ flex: 1, border: 'none', width: '100%' }}
            title="Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
            La preview apparirà qui dopo che l&apos;AI genera il sito
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: 'white', borderRadius: '0.5rem', padding: '2rem', maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#1c1917' }}>Impostazioni Progetto</h2>
              <button onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
                style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#78716c' }}>×</button>
            </div>

            {/* Current domain info */}
            <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: '0.375rem', borderLeft: '3px solid #3b82f6' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', color: '#6b7280' }}>Dominio di preview (staging)</p>
              <p style={{ margin: 0, fontSize: '0.9rem', fontFamily: 'monospace', color: '#1c1917', fontWeight: 500 }}>myweb.factulista.com/{projectSlug}</p>
            </div>

            {/* Custom domain form */}
            {!customDomain || customDomainStatus !== 'verified' ? (
              <form onSubmit={handleAddCustomDomain} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: '#1c1917' }}>
                  Dominio Personalizzato (Production)
                </label>
                <input
                  type="text"
                  placeholder="es: miodominio.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  disabled={addingDomain}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', marginBottom: '1rem', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
                <button
                  type="submit"
                  disabled={addingDomain || !customDomain.trim()}
                  style={{
                    width: '100%', padding: '0.5rem', background: customDomain.trim() && !addingDomain ? '#1c1917' : '#d6d3d1',
                    color: 'white', border: 'none', borderRadius: '0.375rem', fontWeight: 500,
                    cursor: customDomain.trim() && !addingDomain ? 'pointer' : 'not-allowed',
                  }}>
                  {addingDomain ? '⏳ Configurazione...' : 'Aggiungi Dominio'}
                </button>
              </form>
            ) : (
              <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f0fdf4', borderRadius: '0.375rem', borderLeft: '3px solid #10b981' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', color: '#6b7280' }}>Dominio Personalizzato (Attivo)</p>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontFamily: 'monospace', color: '#1c1917', fontWeight: 500 }}>{customDomain}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#059669' }}>✓ Verificato e attivo</p>
              </div>
            )}

            {/* DNS Instructions */}
            {dnsInstructions && (
              <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '0.375rem', borderLeft: '3px solid #f59e0b', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 500, color: '#1c1917' }}>Configura il tuo DNS:</p>
                <pre style={{ margin: 0, fontSize: '0.75rem', color: '#1c1917', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {dnsInstructions}
                </pre>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#78716c' }}>La verifica può impiegare fino a 15 minuti.</p>
              </div>
            )}

            <button onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
              style={{ width: '100%', padding: '0.5rem', background: '#e5e7eb', color: '#1c1917', border: 'none', borderRadius: '0.375rem', fontWeight: 500, cursor: 'pointer' }}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
