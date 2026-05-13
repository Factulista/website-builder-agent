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
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
        return
      }
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
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>I tuoi siti</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/projects/new"><button>Nuovo progetto</button></Link>
          <button onClick={handleLogout} style={{ background: '#6b7280' }}>Logout</button>
        </div>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', color: '#9ca3af' }}>Caricamento...</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '4rem' }}>
          <p style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Nessun progetto ancora</p>
          <Link href="/projects/new"><button>Crea il tuo primo sito</button></Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
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
              }}>
                {/* Thumbnail preview */}
                <Link href={`/projects/${project.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
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

                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                      style={{ padding: '0.5rem', border: '1px solid #2563eb', borderRadius: '0.25rem', fontSize: '1rem', fontWeight: 'bold' }}
                    />
                  ) : (
                    <Link href={`/projects/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <h3 style={{ fontSize: '1rem' }}>{project.name}</h3>
                    </Link>
                  )}
                  <p style={{ color: '#6b7280', fontSize: '0.8rem', fontFamily: 'monospace' }}>/{project.slug}</p>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      onClick={() => startRename(project.id, project.name)}
                      style={{ background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    >
                      Rinomina
                    </button>
                    <button
                      onClick={() => handleDelete(project.id, project.name)}
                      style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
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
    </main>
  )
}
