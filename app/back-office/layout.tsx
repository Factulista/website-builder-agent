'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { isAdmin } from '../../lib/admin'
import { Sidebar } from '../../components/Sidebar'

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
        {children}
      </main>
    </div>
  )
}
