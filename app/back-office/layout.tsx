'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { isAdmin } from '../../lib/admin'
import { Sidebar } from '../../components/Sidebar'
import { AgentsTabs } from '../../components/AgentsTabs'

// Tabs appear only on the 3 index pages — not on detail views like
// /back-office/agents/[name] or /back-office/runs/[id]
function isAgentsTabbedRoute(pathname: string): boolean {
  return (
    pathname === '/back-office/agents' ||
    pathname === '/back-office/pipeline' ||
    pathname === '/back-office/runs'
  )
}

type Project = {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at?: string
  site_config?: { html?: string; pages?: Array<{ slug: string; name: string; html: string }> } | null
}

export default function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/login')
          return
        }
        if (!isAdmin(session.user.email)) {
          router.push('/projects')
          return
        }
        setUserEmail(session.user.email ?? '')

        // Fetch recent projects for sidebar
        const { data } = await supabase
          .from('projects')
          .select('id, name, slug, created_at, updated_at, site_config')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false, nullsFirst: false })
        setProjects(data ?? [])

        setAuthorized(true)
      } catch (err) {
        console.error('Auth check failed:', err)
        router.push('/login')
      }
    }
    checkAuth()
  }, [router])

  if (authorized === null) {
    return (
      <div style={{ minHeight: '100vh', background: '#faf9f7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b9896', fontFamily: 'inherit' }}>
        Caricamento...
      </div>
    )
  }
  if (!authorized) return null

  return (
    <div style={{ minHeight: '100vh', background: '#faf9f7', fontFamily: 'inherit', display: 'flex' }}>
      <Sidebar userEmail={userEmail} projects={projects} />
      <main style={{ flex: 1, overflow: 'auto' }}>
        {isAgentsTabbedRoute(pathname) && <AgentsTabs />}
        {children}
      </main>
    </div>
  )
}
