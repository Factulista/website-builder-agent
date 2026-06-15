'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { Sidebar } from '../../components/Sidebar'

type Connection = {
  id: string
  provider: string
  external_id: string
  account_name: string | null
  status: string
  meta: Record<string, unknown>
}
type SocialPost = {
  id: string
  content: { text?: string; mediaUrls?: string[]; link?: string }
  connection_ids: string[]
  status: string
  results: Record<string, { status: string; url?: string; error?: string; network?: string }>
  created_at: string
}

const PROVIDER_META: Record<string, { label: string; icon: string; color: string }> = {
  facebook: { label: 'Facebook', icon: 'f', color: '#1877F2' },
  instagram: { label: 'Instagram', icon: '◎', color: '#E1306C' },
  linkedin: { label: 'LinkedIn', icon: 'in', color: '#0A66C2' },
}

const C = {
  border: '#e8e4de', borderLight: '#f0ece6', text: '#1a1a1a', textFaint: '#9b9896',
  bg: '#faf9f7', white: '#fff', blue: '#2563eb',
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' }
}

function statusColor(s: string) {
  return s === 'published' ? '#16a34a' : s === 'partial' ? '#f59e0b' : s === 'failed' ? '#ef4444'
    : s === 'scheduled' ? '#2563eb' : '#9b9896'
}

function SocialPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userEmail, setUserEmail] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // Composer state
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [link, setLink] = useState('')
  const [selectedConns, setSelectedConns] = useState<string[]>([])
  const [publishing, setPublishing] = useState(false)

  const loadAll = useCallback(async () => {
    const h = await authHeader()
    const [c, p] = await Promise.all([
      fetch('/api/social/connections', { headers: h }).then(r => r.json()),
      fetch('/api/social/posts', { headers: h }).then(r => r.json()),
    ])
    setConnections(c.connections ?? [])
    setPosts(p.posts ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email ?? '')
      supabase.from('projects').select('id, name').is('deleted_at', null)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .then(({ data }) => setProjects(data ?? []))
      loadAll()
    })
  }, [router, loadAll])

  // Toast after OAuth callback redirect
  useEffect(() => {
    const connected = searchParams.get('connected')
    const status = searchParams.get('status')
    if (connected && status) {
      const label = PROVIDER_META[connected]?.label ?? connected
      setToast(status === 'ok' ? `✅ ${label} collegato!`
        : status === 'denied' ? `Autorizzazione annullata`
        : status === 'no_targets' ? `Nessuna pagina trovata su ${label}`
        : `Errore nel collegamento a ${label}`)
      window.history.replaceState({}, '', '/social')
      loadAll()
      setTimeout(() => setToast(null), 5000)
    }
  }, [searchParams, loadAll])

  const connect = async (provider: string) => {
    const h = await authHeader()
    const res = await fetch(`/api/social/connect/${provider}`, { headers: h }).then(r => r.json())
    if (res.url) window.location.href = res.url
    else setToast(res.error || 'Errore')
  }

  const disconnect = async (id: string) => {
    const h = await authHeader()
    await fetch(`/api/social/connections?id=${id}`, { method: 'DELETE', headers: h })
    setConnections(prev => prev.filter(c => c.id !== id))
    setSelectedConns(prev => prev.filter(c => c !== id))
  }

  const publish = async () => {
    if (selectedConns.length === 0) { setToast('Seleziona almeno un account'); return }
    if (!text && !imageUrl) { setToast('Scrivi un testo o aggiungi un\'immagine'); return }
    setPublishing(true)
    const h = await authHeader()
    const res = await fetch('/api/social/publish', {
      method: 'POST', headers: h,
      body: JSON.stringify({
        content: { text, mediaUrls: imageUrl ? [imageUrl] : [], link: link || undefined },
        connectionIds: selectedConns,
      }),
    }).then(r => r.json())
    setPublishing(false)
    if (res.status) {
      setToast(res.status === 'published' ? '✅ Pubblicato!' : res.status === 'partial' ? '⚠️ Pubblicato parzialmente' : '❌ Pubblicazione fallita')
      setText(''); setImageUrl(''); setLink(''); setSelectedConns([])
      loadAll()
    } else setToast(res.error || 'Errore')
    setTimeout(() => setToast(null), 5000)
  }

  const toggleConn = (id: string) =>
    setSelectedConns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, fontFamily: 'system-ui, sans-serif' }}>
      <Sidebar userEmail={userEmail} projects={projects} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, marginBottom: '4px' }}>Social</h1>
        <p style={{ fontSize: '0.85rem', color: C.textFaint, marginBottom: '28px' }}>
          Collega i tuoi account e pubblica post da articoli, pagine o contenuto libero.
        </p>

        {/* ── Connections ── */}
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Account collegati</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {connections.map(conn => {
              const pm = PROVIDER_META[conn.provider]
              return (
                <div key={conn.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px 14px' }}>
                  <span style={{ width: '28px', height: '28px', borderRadius: '6px', background: pm?.color ?? '#888', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>{pm?.icon}</span>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>{conn.account_name}</div>
                    <div style={{ fontSize: '0.7rem', color: C.textFaint }}>{pm?.label}</div>
                  </div>
                  <button onClick={() => disconnect(conn.id)} style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: '0.9rem', marginLeft: '4px' }} title="Scollega">×</button>
                </div>
              )
            })}
            {/* Connect buttons */}
            <button onClick={() => connect('facebook')} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: C.white, border: `1px dashed ${C.border}`, borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', color: C.text, fontFamily: 'inherit' }}>
              <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#1877F2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem' }}>f</span>
              + Collega Facebook
            </button>
          </div>
        </section>

        {/* ── Composer ── */}
        <section style={{ marginBottom: '32px', maxWidth: '640px' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Nuovo post</h2>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '16px' }}>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Scrivi il post..." rows={4}
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px' }} />
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="URL immagine (opzionale)"
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 12px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: '10px' }} />
            <input value={link} onChange={e => setLink(e.target.value)} placeholder="Link (opzionale)"
              style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 12px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: '14px' }} />

            {/* Target selection */}
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, marginBottom: '8px' }}>Pubblica su:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              {connections.length === 0 && <span style={{ fontSize: '0.8rem', color: C.textFaint }}>Collega prima un account.</span>}
              {connections.map(conn => {
                const sel = selectedConns.includes(conn.id)
                const pm = PROVIDER_META[conn.provider]
                return (
                  <button key={conn.id} onClick={() => toggleConn(conn.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${sel ? C.blue : C.border}`, background: sel ? '#eff6ff' : C.white, color: sel ? C.blue : C.text, borderRadius: '7px', padding: '5px 10px', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {sel ? '✓' : ''} {pm?.label} · {conn.account_name}
                  </button>
                )
              })}
            </div>

            <button onClick={publish} disabled={publishing}
              style={{ background: publishing ? '#93c5fd' : C.blue, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: publishing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {publishing ? 'Pubblicazione...' : 'Pubblica ora'}
            </button>
          </div>
        </section>

        {/* ── Post history ── */}
        <section style={{ maxWidth: '640px' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Post</h2>
          {loading ? <p style={{ fontSize: '0.85rem', color: C.textFaint }}>Caricamento...</p>
            : posts.length === 0 ? <p style={{ fontSize: '0.85rem', color: C.textFaint }}>Nessun post ancora.</p>
            : posts.map(post => (
              <div key={post.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <p style={{ fontSize: '0.85rem', color: C.text, margin: 0, flex: 1, lineHeight: 1.4 }}>{post.content.text || '(senza testo)'}</p>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '5px', background: statusColor(post.status) + '18', color: statusColor(post.status), whiteSpace: 'nowrap' }}>{post.status}</span>
                </div>
                {Object.values(post.results ?? {}).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {Object.values(post.results).map((r, i) => (
                      <span key={i} style={{ fontSize: '0.7rem', color: r.status === 'published' ? '#16a34a' : '#ef4444' }}>
                        {PROVIDER_META[r.network ?? '']?.label ?? r.network}: {r.status === 'published' ? (r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#16a34a' }}>vedi ↗</a> : 'ok') : (r.error ?? 'errore')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </section>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: C.text, color: '#fff', padding: '10px 20px', borderRadius: '10px', fontSize: '0.85rem', boxShadow: '0 6px 20px rgba(0,0,0,0.2)', zIndex: 1000 }}>{toast}</div>
      )}
    </div>
  )
}

export default function SocialPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', color: '#9b9896' }}>Caricamento...</div>}>
      <SocialPageInner />
    </Suspense>
  )
}
