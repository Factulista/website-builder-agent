'use client'

import { useState } from 'react'
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

export function Sidebar({ userEmail, projects }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { language, loaded } = useLanguage()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const userInitial = userEmail?.[0]?.toUpperCase() ?? 'U'

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
        <NavItem icon="⌂" label={loaded ? t('sidebar.home' as const, language) : 'Home'} href="/projects" active={pathname === '/projects'} />
        <NavItem icon="⌕" label={loaded ? t('sidebar.search' as const, language) : 'Search'} shortcut="⌘K" />

        <SectionLabel>{loaded ? t('sidebar.projects' as const, language) : 'Projects'}</SectionLabel>
        <NavItem icon="⊞" label={loaded ? t('sidebar.allSites' as const, language) : 'All sites'} href="/projects" active={pathname === '/projects'} />
        <NavItem icon="✦" label={loaded ? t('sidebar.newSite' as const, language) : 'New site'} href="/projects/new" active={pathname === '/projects/new'} />

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
            <NavItem icon="⌬" label={loaded ? t('sidebar.agents' as const, language) : 'Agents'} href="/back-office/agents" active={pathname.startsWith('/back-office/agents')} />
            <NavItem icon="◇" label={loaded ? t('sidebar.workflow' as const, language) : 'Workflow'} href="/back-office/pipeline" active={pathname.startsWith('/back-office/pipeline')} />
            <NavItem icon="◉" label={loaded ? t('sidebar.runs' as const, language) : 'Runs'} href="/back-office/runs" active={pathname.startsWith('/back-office/runs')} />
            <NavItem icon="▦" label={loaded ? t('sidebar.templates' as const, language) : 'Templates'} href="/back-office/templates" active={pathname.startsWith('/back-office/templates')} />
            <NavItem icon="⚙" label={loaded ? t('sidebar.settings' as const, language) : 'Settings'} href="/back-office/settings" active={pathname.startsWith('/back-office/settings')} />
          </>
        )}
      </nav>

      {/* User section */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid #e8e4de' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'white', border: '1px solid #e8e4de', borderRadius: '10px' }}>
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
            {loaded ? t('sidebar.logout' as const, language) : 'Logout'}
          </button>
        </div>
      </div>
    </aside>
  )
}
