'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { confirmDialog } from '../../lib/dialog'
import { isAdmin } from '../../lib/admin'

type Page = { slug: string; name: string; html: string }
type Project = {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at?: string
  site_config?: { html?: string; pages?: Page[] } | null
}

function getHomeHtml(project: Project): string | undefined {
  const config = project.site_config
  if (config?.pages && config.pages.length > 0) {
    return config.pages.find(p => p.slug === 'home')?.html ?? config.pages[0].html
  }
  return config?.html
}

function groupByRecency(projects: Project[]) {
  const now = Date.now()
  const day14 = 14 * 24 * 60 * 60 * 1000
  const day60 = 60 * 24 * 60 * 60 * 1000

  const recent: Project[] = []
  const active: Project[] = []
  const older: Project[] = []

  for (const p of projects) {
    const t = new Date(p.updated_at ?? p.created_at).getTime()
    const diff = now - t
    if (diff <= day14) recent.push(p)
    else if (diff <= day60) active.push(p)
    else older.push(p)
  }

  return { recent, active, older }
}

function NavItem({
  icon, label, href, active, shortcut, onClick,
}: {
  icon?: string
  label: string
  href?: string
  active?: boolean
  shortcut?: string
  onClick?: () => void
}) {
  const content = (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 10px', borderRadius: '7px',
        background: active ? 'white' : 'transparent',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
        color: active ? '#1a1a1a' : '#6b6563',
        fontSize: '0.8375rem', fontWeight: active ? 500 : 400,
        cursor: 'pointer', userSelect: 'none' as const,
        transition: 'background 0.12s',
        justifyContent: 'space-between',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon && <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>{icon}</span>}
        {label}
      </div>
      {shortcut && (
        <span style={{ display: 'flex', gap: '2px' }}>
          {shortcut.split('').map((k, i) => (
            <kbd key={i} style={{ background: '#e8e4de', border: '1px solid #d4cfc9', borderRadius: '4px', padding: '0 4px', fontSize: '0.7rem', color: '#6b6563', fontFamily: 'inherit' }}>
              {k}
            </kbd>
          ))}
        </span>
      )}
    </div>
  )

  if (href) return <Link href={href} style={{ textDecoration: 'none' }}>{content}</Link>
  return content
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 10px 4px', fontSize: '0.7rem', fontWeight: 600, color: '#9b9896', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function ProjectCard({
  project, onDelete, onRename,
}: {
  project: Project
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [nameVal, setNameVal] = useState(project.name)
  const homeHtml = getHomeHtml(project)
  const updatedAt = new Date(project.updated_at ?? project.created_at)
  const timeStr = updatedAt.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })

  return (
    <div style={{ borderRadius: '12px', overflow: 'hidden', background: 'white', border: '1px solid #e8e4de', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
      <Link href={`/projects/${project.id}`} style={{ display: 'block', textDecoration: 'none' }}>
        <div style={{ height: '170px', background: '#f4f2ef', overflow: 'hidden', position: 'relative' }}>
          {homeHtml ? (
            <iframe
              srcDoc={homeHtml}
              style={{ width: '400%', height: '400%', border: 'none', transform: 'scale(0.25)', transformOrigin: 'top left', pointerEvents: 'none' }}
              sandbox=""
              title={project.name}
            />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b0aba7', fontSize: '0.8rem' }}>
              Nessun sito generato
            </div>
          )}
        </div>
      </Link>

      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#e05a2b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.65rem', fontWeight: 700 }}>
            F
          </div>
          {renaming ? (
            <input
              type="text"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={() => { onRename(nameVal.trim() || project.name); setRenaming(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onRename(nameVal.trim() || project.name); setRenaming(false) }
                if (e.key === 'Escape') { setNameVal(project.name); setRenaming(false) }
              }}
              autoFocus
              style={{ flex: 1, padding: '2px 6px', border: '1px solid #2563eb', borderRadius: '5px', fontSize: '0.8375rem', fontWeight: 600, fontFamily: 'inherit', outline: 'none' }}
            />
          ) : (
            <Link href={`/projects/${project.id}`} style={{ textDecoration: 'none', flex: 1 }}>
              <span style={{ fontSize: '0.8375rem', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                {project.name}
              </span>
            </Link>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: '#9b9896' }}>Modificato {timeStr}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setRenaming(true)}
              style={{ background: 'transparent', color: '#9b9896', border: '1px solid #e8e4de', padding: '3px 8px', fontSize: '0.72rem', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Rinomina
            </button>
            <button
              onClick={onDelete}
              style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '3px 8px', fontSize: '0.72rem', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Elimina
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectGroup({ title, projects, onDelete, onRename }: {
  title: string
  projects: Project[]
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
}) {
  if (projects.length === 0) return null
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '0.8rem', fontWeight: 500, color: '#6b6563', marginBottom: '12px' }}>{title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            onDelete={() => onDelete(p.id, p.name)}
            onRename={(name) => onRename(p.id, name)}
          />
        ))}
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      setUserEmail(session.user.email ?? '')
      supabase
        .from('projects')
        .select('id, name, slug, created_at, updated_at, site_config')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .then(({ data }) => { setProjects(data ?? []); setLoading(false) })
    })
  }, [router])

  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/login') }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: 'Eliminare progetto',
      message: `"${name}" verrà spostato nel cestino.`,
      confirmLabel: 'Elimina',
      variant: 'danger',
    })
    if (!ok) return
    await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const handleRename = async (id: string, name: string) => {
    if (!name.trim()) return
    await supabase.from('projects').update({ name }).eq('id', id)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p))
  }

  const { recent, active, older } = useMemo(() => groupByRecency(projects), [projects])

  const userInitial = userEmail?.[0]?.toUpperCase() ?? 'U'

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px', flexShrink: 0,
        background: '#f4f2ef',
        borderRight: '1px solid #e8e4de',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Logo + toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '26px', height: '26px', background: 'linear-gradient(135deg, #ff6b6b 0%, #ffa94d 100%)', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontSize: '0.75rem', fontWeight: 700 }}>F</span>
            </div>
          </div>
          <button
            style={{ background: 'transparent', border: 'none', color: '#9b9896', padding: '4px', borderRadius: '6px', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
            title="Toggle sidebar"
          >
            ⊡
          </button>
        </div>

        {/* Workspace selector */}
        <div style={{ padding: '0 10px 6px' }}>
          <button style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '7px 10px', background: 'white',
            border: '1px solid #e0dcd6', borderRadius: '8px', cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '20px', height: '20px', background: '#e05a2b', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.65rem', fontWeight: 700 }}>
                {userInitial}
              </div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#1a1a1a' }}>
                {userEmail.split('@')[0] ?? 'Workspace'}
              </span>
            </div>
            <span style={{ fontSize: '0.7rem', color: '#9b9896' }}>▾</span>
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '2px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <NavItem icon="⌂" label="Home" href="/projects" active />
          <NavItem icon="⌕" label="Cerca" shortcut="⌘K" />

          <SectionLabel>Progetti</SectionLabel>
          <NavItem icon="⊞" label="Tutti i siti" href="/projects" />
          <NavItem icon="✦" label="Nuovo sito" href="/projects/new" />

          {projects.length > 0 && (
            <>
              <SectionLabel>Recenti</SectionLabel>
              {projects.slice(0, 5).map(p => (
                <NavItem key={p.id} label={p.name} href={`/projects/${p.id}`} />
              ))}
            </>
          )}

          {isAdmin(userEmail) && (
            <>
              <SectionLabel>Back Office</SectionLabel>
              <NavItem icon="⌬" label="Agents" href="/back-office/agents" />
              <NavItem icon="◇" label="Pipeline" href="/back-office/pipeline" />
            </>
          )}
        </nav>

        {/* Bottom cards + user */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid #e8e4de', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: 'white', border: '1px solid #e8e4de', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: '#1a1a1a' }}>Upgrade al Pro</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#9b9896' }}>Sblocca più funzionalità</p>
            </div>
            <div style={{ width: '28px', height: '28px', background: '#7c3aed', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: 'white', fontSize: '0.8rem' }}>⚡</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '26px', height: '26px', background: '#e05a2b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>
                {userInitial}
              </div>
              <span style={{ fontSize: '0.78rem', color: '#6b6563', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userEmail}
              </span>
            </div>
            <button
              onClick={handleLogout}
              style={{ background: 'transparent', border: 'none', color: '#9b9896', fontSize: '0.75rem', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' }}
            >
              Esci
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflowY: 'auto', background: '#faf9f7', padding: '2rem 2.5rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#1a1a1a', margin: 0 }}>Progetti</h1>
            <Link href="/projects/new" style={{ textDecoration: 'none' }}>
              <button style={{
                background: '#1a1a1a', color: 'white', border: 'none',
                padding: '7px 16px', borderRadius: '8px', fontWeight: 500,
                fontSize: '0.8375rem', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}>
                Crea <span style={{ opacity: 0.6 }}>▾</span>
              </button>
            </Link>
          </div>

          {loading ? (
            <p style={{ color: '#9b9896', fontSize: '0.875rem' }}>Caricamento...</p>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: '5rem' }}>
              <p style={{ fontSize: '1rem', color: '#6b6563', marginBottom: '1rem' }}>Nessun sito ancora</p>
              <Link href="/projects/new">
                <button style={{ background: '#1a1a1a', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Crea il tuo primo sito
                </button>
              </Link>
            </div>
          ) : (
            <>
              <ProjectGroup title="Attivi negli ultimi 14 giorni" projects={recent} onDelete={handleDelete} onRename={handleRename} />
              <ProjectGroup title="Attivi negli ultimi 60 giorni" projects={active} onDelete={handleDelete} onRename={handleRename} />
              <ProjectGroup title="Più vecchi" projects={older} onDelete={handleDelete} onRename={handleRename} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
