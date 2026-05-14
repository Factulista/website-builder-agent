'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Page = { slug: string; name: string; html: string }
type Project = {
  id: string
  name: string
  slug: string
  created_at: string
  site_config?: { html?: string; pages?: Page[] } | null
}

function getHomeHtml(project: Project): string | undefined {
  const config = project.site_config
  if (config?.pages && config.pages.length > 0) {
    return config.pages.find(p => p.slug === 'home')?.html ?? config.pages[0].html
  }
  return config?.html
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
        return
      }
      setUserEmail(session.user.email ?? '')
      supabase
        .from('projects')
        .select('id, name, slug, created_at, site_config')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          setProjects(data ?? [])
          setLoading(false)
        })
    })
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Eliminare "${name}"? L'azione è irreversibile.`)) return
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { alert(`Errore: ${error.message}`); return }
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  const confirmRename = async (id: string) => {
    const newName = renameValue.trim()
    if (!newName) { setRenamingId(null); return }
    const { error } = await supabase
      .from('projects')
      .update({ name: newName })
      .eq('id', id)
    if (error) { alert(`Errore: ${error.message}`); return }
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p))
    setRenamingId(null)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f9fafb' }}>
      {/* Sidebar */}
      <aside style={{
        width: '220px',
        flexShrink: 0,
        background: '#1c1917',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 0',
      }}>
        {/* Logo */}
        <div style={{ padding: '0 1.25rem 1.5rem', borderBottom: '1px solid #292524' }}>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'white', letterSpacing: '-0.02em' }}>
            Factulista
          </span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            background: '#292524',
            color: 'white',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'default',
          }}>
            I tuoi siti
          </div>

          <Link href="/projects/new" style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              color: '#a8a29e',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#292524')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              + Nuovo sito
            </div>
          </Link>
        </nav>

        {/* User + Logout */}
        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid #292524' }}>
          {userEmail && (
            <p style={{ fontSize: '0.75rem', color: '#78716c', marginBottom: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {userEmail}
            </p>
          )}
          <button
            onClick={handleLogout}
            style={{
              width: '100%', padding: '0.4rem 0.75rem', background: 'transparent',
              color: '#a8a29e', border: '1px solid #292524', borderRadius: '0.375rem',
              fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left',
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#1c1917', margin: 0 }}>I tuoi siti</h1>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {projects.length} {projects.length === 1 ? 'sito' : 'siti'}
            </p>
          </div>

          {loading ? (
            <p style={{ color: '#9ca3af' }}>Caricamento...</p>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '4rem' }}>
              <p style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#57534e' }}>Nessun sito ancora</p>
              <Link href="/projects/new"><button>Crea il tuo primo sito</button></Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
              {projects.map((project) => {
                const homeHtml = getHomeHtml(project)
                const hasHtml = !!homeHtml
                const isRenaming = renamingId === project.id
                return (
                  <div key={project.id} style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    overflow: 'hidden',
                    background: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    <Link href={`/projects/${project.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                      <div style={{ height: '160px', borderBottom: '1px solid #e5e7eb', overflow: 'hidden', background: '#f9fafb', position: 'relative' }}>
                        {hasHtml ? (
                          <iframe
                            srcDoc={homeHtml}
                            style={{ width: '400%', height: '400%', border: 'none', transform: 'scale(0.25)', transformOrigin: 'top left', pointerEvents: 'none' }}
                            sandbox=""
                            title={project.name}
                          />
                        ) : (
                          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                            Nessun sito generato
                          </div>
                        )}
                      </div>
                    </Link>

                    <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => confirmRename(project.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmRename(project.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          autoFocus
                          style={{ padding: '0.4rem', border: '1px solid #2563eb', borderRadius: '0.25rem', fontSize: '0.9rem', fontWeight: 600 }}
                        />
                      ) : (
                        <Link href={`/projects/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1c1917', margin: 0 }}>{project.name}</h3>
                        </Link>
                      )}
                      <p style={{ color: '#9ca3af', fontSize: '0.75rem', fontFamily: 'monospace', margin: 0 }}>myweb.factulista.com/{project.slug}</p>

                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button
                          onClick={() => startRename(project.id, project.name)}
                          style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', padding: '0.3rem 0.65rem', fontSize: '0.75rem', borderRadius: '0.25rem' }}
                        >
                          Rinomina
                        </button>
                        <button
                          onClick={() => handleDelete(project.id, project.name)}
                          style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '0.3rem 0.65rem', fontSize: '0.75rem', borderRadius: '0.25rem' }}
                        >
                          Elimina
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
