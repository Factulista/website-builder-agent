'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { isAdmin } from '../lib/admin'
import { useLanguage } from '../lib/i18n/useLanguage'
import { t } from '../lib/i18n/translations'

type SidebarProps = {
  userEmail: string
  projects: Array<{ id: string; name: string }>
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

type SearchResult = {
  type: 'menu' | 'project'
  label: string
  href: string
  icon?: string
}

function SearchBar({
  projects,
  router,
  language,
  loaded,
}: {
  projects: Array<{ id: string; name: string }>
  router: ReturnType<typeof useRouter>
  language: any
  loaded: boolean
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)

  const menuItems = [
    { label: loaded ? t('sidebar.projects' as const, language) : 'Projects', href: '/projects', icon: '⊞' },
    { label: loaded ? t('sidebar.newSite' as const, language) : 'New site', href: '/projects/new', icon: '✦' },
    { label: 'Agents', href: '/back-office/agents', icon: '⌬' },
    { label: loaded ? t('sidebar.templates' as const, language) : 'Templates', href: '/back-office/templates', icon: '▦' },
    { label: 'Componenti', href: '/back-office/components', icon: '🧩' },
    { label: loaded ? t('sidebar.settings' as const, language) : 'Settings', href: '/back-office/settings', icon: '⚙' },
  ]

  const handleSearch = (query: string) => {
    setSearch(query)
    if (query.trim() === '') {
      setResults([])
      setShowResults(false)
      return
    }

    const lowerQuery = query.toLowerCase()
    const found: SearchResult[] = []

    // Search menu items
    menuItems.forEach(item => {
      if (item.label.toLowerCase().includes(lowerQuery)) {
        found.push({
          type: 'menu',
          label: item.label,
          href: item.href,
          icon: item.icon,
        })
      }
    })

    // Search projects
    projects.forEach(project => {
      if (project.name.toLowerCase().includes(lowerQuery)) {
        found.push({
          type: 'project',
          label: project.name,
          href: `/projects/${project.id}`,
        })
      }
    })

    setResults(found)
    setShowResults(true)
  }

  const handleSelectResult = (href: string) => {
    setSearch('')
    setShowResults(false)
    router.push(href)
  }

  return (
    <div style={{ padding: '8px 10px 12px', position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder={loaded ? t('sidebar.search' as const, language) : 'Search...'}
          value={search}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => search && setShowResults(true)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #e8e4de',
            borderRadius: '8px',
            background: 'white',
            color: '#1a1a1a',
            fontSize: '0.8375rem',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        {/* Results dropdown */}
        {showResults && results.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'white',
            border: '1px solid #e8e4de',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {results.map((result, idx) => (
              <button
                key={`${result.type}-${result.href}-${idx}`}
                onClick={() => handleSelectResult(result.href)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: '#1a1a1a',
                  fontSize: '0.8rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderBottom: idx < results.length - 1 ? '1px solid #f0f0f0' : 'none',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f9f9f9'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {result.icon && <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>{result.icon}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {result.label}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#9b9896', marginTop: '2px' }}>
                    {result.type === 'project' ? '📁 Progetto' : '⚙️ Menu'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* No results message */}
        {showResults && search && results.length === 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'white',
            border: '1px solid #e8e4de',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            padding: '12px',
            fontSize: '0.8rem',
            color: '#9b9896',
            textAlign: 'center',
            zIndex: 1000,
          }}>
            {loaded ? 'Nessun risultato trovato' : 'No results found'}
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar({ userEmail, projects }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { language, loaded } = useLanguage()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const meta = session?.user?.user_metadata ?? {}
      setFirstName(meta.first_name ?? '')
      setLastName(meta.last_name ?? '')
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleSettings = () => {
    setUserMenuOpen(false)
    router.push('/back-office/settings')
  }

  const saveProfile = async () => {
    await supabase.auth.updateUser({ data: { first_name: firstName, last_name: lastName } })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  const displayName = [firstName, lastName].filter(Boolean).join(' ') || userEmail
  const userInitial = (firstName?.[0]?.toUpperCase() || userEmail?.[0]?.toUpperCase()) ?? 'U'

  return (
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

      {/* Search bar */}
      <SearchBar projects={projects} router={router} language={language} loaded={loaded} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: '2px 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1px' }}>

        <SectionLabel>{loaded ? t('sidebar.projects' as const, language) : 'Projects'}</SectionLabel>
        <NavItem icon="⊞" label={loaded ? t('sidebar.allSites' as const, language) : 'All sites'} href="/projects" active={pathname === '/projects'} />
        <NavItem icon="✦" label={loaded ? t('sidebar.newSite' as const, language) : 'New site'} href="/projects/new" active={pathname === '/projects/new'} />

        <SectionLabel>Marketing</SectionLabel>
        <NavItem icon="📣" label="Social" href="/social" active={pathname.startsWith('/social')} />

        {projects.length > 0 && (
          <>
            <SectionLabel>{loaded ? t('sidebar.recent' as const, language) : 'Recent'}</SectionLabel>
            {projects.slice(0, 5).map(p => (
              <NavItem key={p.id} label={p.name} href={`/projects/${p.id}`} active={pathname === `/projects/${p.id}`} />
            ))}
          </>
        )}

        {isAdmin(userEmail) && (
          <>
            <SectionLabel>{loaded ? t('sidebar.backOffice' as const, language) : 'Back Office'}</SectionLabel>
            <NavItem
              icon="⌬"
              label="Agents"
              href="/back-office/agents"
              active={
                pathname.startsWith('/back-office/agents') ||
                pathname.startsWith('/back-office/pipeline') ||
                pathname.startsWith('/back-office/runs')
              }
            />
            <NavItem icon="▦" label={loaded ? t('sidebar.templates' as const, language) : 'Templates'} href="/back-office/templates" active={pathname.startsWith('/back-office/templates')} />
            <NavItem icon="🧩" label="Componenti" href="/back-office/components" active={pathname.startsWith('/back-office/components')} />
          </>
        )}
      </nav>

      {/* User section */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid #e8e4de', position: 'relative' }}>
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '8px 10px',
            background: 'white',
            border: `1px solid ${userMenuOpen ? '#2563eb' : '#e8e4de'}`,
            borderRadius: '10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            if (!userMenuOpen) {
              (e.currentTarget as HTMLElement).style.borderColor = '#d4cfc9'
              ;(e.currentTarget as HTMLElement).style.background = '#fafafa'
            }
          }}
          onMouseLeave={e => {
            if (!userMenuOpen) {
              (e.currentTarget as HTMLElement).style.borderColor = '#e8e4de'
              ;(e.currentTarget as HTMLElement).style.background = 'white'
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '26px', height: '26px', background: '#e05a2b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0 }}>
              {userInitial}
            </div>
            <div style={{ minWidth: 0 }}>
              {(firstName || lastName) && (
                <div style={{ fontSize: '0.78rem', color: '#1a1a1a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                  {[firstName, lastName].filter(Boolean).join(' ')}
                </div>
              )}
              <div style={{ fontSize: '0.7rem', color: '#9b9896', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                {userEmail}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.7rem', color: '#9b9896', transition: 'transform 0.2s', transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </span>
        </button>

        {/* User menu dropdown */}
        {userMenuOpen && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '10px',
            right: '10px',
            background: 'white',
            border: '1px solid #e8e4de',
            borderRadius: '10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 1000,
            marginBottom: '8px',
            overflow: 'hidden',
          }}>
            {/* Profile option — visible to all */}
            <button
              onClick={() => { setUserMenuOpen(false); setShowProfileModal(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', color: '#1a1a1a', fontSize: '0.8375rem', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f9f9f9'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <span style={{ fontSize: '0.95rem' }}>👤</span>
              Profilo
            </button>

            {/* Settings option (only for admin) */}
            {isAdmin(userEmail) && (
              <button
                onClick={handleSettings}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', color: '#1a1a1a', fontSize: '0.8375rem', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #f0f0f0' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f9f9f9'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <span style={{ fontSize: '0.95rem' }}>⚙️</span>
                {loaded ? t('sidebar.settings' as const, language) : 'Settings'}
              </button>
            )}

            {/* Logout option */}
            <button
              onClick={() => { setUserMenuOpen(false); handleLogout() }}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', color: '#ef4444', fontSize: '0.8375rem', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#fef2f2'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <span style={{ fontSize: '0.95rem' }}>🚪</span>
              {loaded ? t('sidebar.logout' as const, language) : 'Logout'}
            </button>
          </div>
        )}
      </div>

      {/* Profile modal */}
      {showProfileModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={() => setShowProfileModal(false)} />
          <div style={{ position: 'relative', background: 'white', borderRadius: '14px', padding: '28px', width: '340px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <button onClick={() => setShowProfileModal(false)} style={{ position: 'absolute', top: '14px', right: '16px', background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#9b9896', lineHeight: 1 }}>✕</button>
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ width: '44px', height: '44px', background: '#e05a2b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '1rem', fontWeight: 700, flexShrink: 0 }}>
                {userInitial}
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1a1a1a' }}>{displayName}</div>
                <div style={{ fontSize: '0.75rem', color: '#9b9896' }}>{userEmail}</div>
              </div>
            </div>
            {/* Fields */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: '#9b9896', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Nome</label>
                <input
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Nome"
                  style={{ width: '100%', border: '1px solid #e8e4de', borderRadius: '8px', padding: '7px 10px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, color: '#9b9896', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Cognome</label>
                <input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Cognome"
                  style={{ width: '100%', border: '1px solid #e8e4de', borderRadius: '8px', padding: '7px 10px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                />
              </div>
            </div>
            <button
              onClick={saveProfile}
              style={{ width: '100%', padding: '9px', background: profileSaved ? '#10b981' : '#1a1a1a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.2s' }}
            >
              {profileSaved ? '✓ Salvato' : 'Salva'}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
