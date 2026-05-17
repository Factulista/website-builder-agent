'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { isAdmin } from '../../lib/admin'

const C = {
  bg: '#faf9f7',
  bgPanel: '#f4f2ef',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  dark: '#1a1a1a',
  blue: '#2563eb',
}

function NavItem({ icon, label, href, active }: { icon: string; label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', borderRadius: '8px',
        textDecoration: 'none',
        background: active ? C.white : 'transparent',
        color: active ? C.text : C.textMuted,
        fontSize: '0.85rem', fontWeight: active ? 600 : 400,
        border: active ? `1px solid ${C.border}` : '1px solid transparent',
        transition: 'background 0.12s',
      }}
    >
      <span style={{ fontSize: '0.95rem', opacity: 0.7 }}>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

export default function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      if (!isAdmin(session.user.email)) { router.push('/projects'); return }
      setAuthorized(true)
    })
  }, [router])

  if (authorized === null) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textFaint, fontFamily: 'inherit' }}>
        Caricamento...
      </div>
    )
  }
  if (!authorized) return null

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'inherit', display: 'flex' }}>
      {/* Sidebar */}
      <aside style={{
        width: '240px', flexShrink: 0,
        background: C.bgPanel, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        padding: '16px 12px',
      }}>
        <div style={{ padding: '4px 10px 16px', borderBottom: `1px solid ${C.border}`, marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '24px', height: '24px', background: C.dark, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>F</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: C.text }}>Back Office</p>
              <p style={{ margin: 0, fontSize: '0.68rem', color: C.textFaint }}>Factulista</p>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <p style={{ margin: '4px 12px 6px', fontSize: '0.62rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Menu
          </p>
          <NavItem icon="⌬" label="Agents" href="/back-office/agents" active={pathname.startsWith('/back-office/agents')} />
          <NavItem icon="◇" label="Pipeline" href="/back-office/pipeline" active={pathname.startsWith('/back-office/pipeline')} />
          <NavItem icon="◉" label="Runs" href="/back-office/runs" active={pathname.startsWith('/back-office/runs')} />
        </nav>

        <Link
          href="/projects"
          style={{
            padding: '8px 12px', fontSize: '0.78rem', color: C.textMuted,
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px',
            borderTop: `1px solid ${C.border}`, marginTop: '12px', paddingTop: '14px',
          }}
        >
          ← Torna ai progetti
        </Link>
      </aside>

      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
