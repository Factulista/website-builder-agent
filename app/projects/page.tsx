'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { confirmDialog } from '../../lib/dialog'
import { Sidebar } from '../../components/Sidebar'
import { useLanguage } from '../../lib/i18n/useLanguage'
import { t } from '../../lib/i18n/translations'

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
  if (config?.pages && Array.isArray(config.pages) && config.pages.length > 0) {
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

function ProjectCard({
  project, onDelete, onRename, onDuplicate, language,
}: {
  project: Project
  onDelete: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  language: string
}) {
  const [renaming, setRenaming] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
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
              {t('projects.noSiteGenerated' as const, language as any)}
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
          <span style={{ fontSize: '0.72rem', color: '#9b9896' }}>{t('projects.modified' as const, language as any)} {timeStr}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setRenaming(true)}
              style={{ background: 'transparent', color: '#9b9896', border: '1px solid #e8e4de', padding: '3px 8px', fontSize: '0.72rem', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('projects.rename' as const, language as any)}
            </button>
            <button
              disabled={duplicating}
              onClick={async () => { setDuplicating(true); await onDuplicate(); setDuplicating(false) }}
              title="Duplica progetto"
              style={{ background: 'transparent', color: '#6b6563', border: '1px solid #e8e4de', padding: '3px 8px', fontSize: '0.72rem', borderRadius: '5px', cursor: duplicating ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: duplicating ? 0.5 : 1 }}
            >
              {duplicating ? '…' : '⧉'}
            </button>
            <button
              onClick={onDelete}
              style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '3px 8px', fontSize: '0.72rem', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('projects.delete' as const, language as any)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectGroup({ title, projects, onDelete, onRename, onDuplicate, language }: {
  title: string
  projects: Project[]
  onDelete: (id: string, name: string) => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => Promise<void>
  language: string
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
            onDuplicate={() => onDuplicate(p.id)}
            language={language}
          />
        ))}
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const { language } = useLanguage()
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
        .then(({ data, error }) => {
          if (error) console.error('[projects] fetch error:', error.message)
          setProjects(data ?? [])
          setLoading(false)
        })
    })
  }, [router])

  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/login') }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: t('projects.deleteProject' as const, language as any),
      message: `"${name}" ${t('projects.deleteConfirm' as const, language as any)}`,
      confirmLabel: t('common.delete' as const, language as any),
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

  const handleDuplicate = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const source = projects.find(p => p.id === id)
    if (!source) return

    // Build a unique slug: base-copia → base-copia-2 → base-copia-3 …
    const existingSlugs = new Set(projects.map(p => p.slug))
    let newSlug = `${source.slug}-copia`
    let counter = 2
    while (existingSlugs.has(newSlug)) { newSlug = `${source.slug}-copia-${counter}`; counter++ }

    const { data: created, error } = await supabase.from('projects').insert({
      name: `${source.name} (copia)`,
      slug: newSlug,
      user_id: session.user.id,
      site_config: source.site_config ?? null,
    }).select('id, name, slug, created_at, updated_at, site_config').single()

    if (!error && created) {
      setProjects(prev => [created as Project, ...prev])
    }
  }

  const { recent, active, older } = useMemo(() => groupByRecency(projects), [projects])

  const userInitial = userEmail?.[0]?.toUpperCase() ?? 'U'

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <Sidebar userEmail={userEmail} projects={projects} />

      {/* Main */}
      <main style={{ flex: 1, overflowY: 'auto', background: '#faf9f7', padding: '2rem 2.5rem' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#1a1a1a', margin: 0 }}>{t('projects.title' as const, language as any)}</h1>
            <Link href="/projects/new" style={{ textDecoration: 'none' }}>
              <button style={{
                background: '#1a1a1a', color: 'white', border: 'none',
                padding: '7px 16px', borderRadius: '8px', fontWeight: 500,
                fontSize: '0.8375rem', cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}>
                {t('projects.create' as const, language as any)} <span style={{ opacity: 0.6 }}>▾</span>
              </button>
            </Link>
          </div>

          {loading ? (
            <p style={{ color: '#9b9896', fontSize: '0.875rem' }}>{t('common.loading' as const, language as any)}</p>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: '5rem' }}>
              <p style={{ fontSize: '1rem', color: '#6b6563', marginBottom: '1rem' }}>{t('projects.noSites' as const, language as any)}</p>
              <Link href="/projects/new">
                <button style={{ background: '#1a1a1a', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t('projects.createFirst' as const, language as any)}
                </button>
              </Link>
            </div>
          ) : (
            <>
              <ProjectGroup title={t('projects.recent' as const, language as any)} projects={recent} onDelete={handleDelete} onRename={handleRename} onDuplicate={handleDuplicate} language={language} />
              <ProjectGroup title={t('projects.active' as const, language as any)} projects={active} onDelete={handleDelete} onRename={handleRename} onDuplicate={handleDuplicate} language={language} />
              <ProjectGroup title={t('projects.older' as const, language as any)} projects={older} onDelete={handleDelete} onRename={handleRename} onDuplicate={handleDuplicate} language={language} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
