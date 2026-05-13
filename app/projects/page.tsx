'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

type Project = {
  id: string
  name: string
  slug: string
  created_at: string
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login')
        return
      }
      supabase
        .from('projects')
        .select('id, name, slug, created_at')
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

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>My Projects</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href="/projects/new">
            <button>New Project</button>
          </Link>
          <button onClick={handleLogout} style={{ background: '#6b7280' }}>Logout</button>
        </div>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', color: '#9ca3af' }}>Loading...</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '4rem' }}>
          <p style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Nessun progetto ancora</p>
          <Link href="/projects/new">
            <button>Crea il tuo primo sito</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <div style={{
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
                padding: '1.5rem',
                cursor: 'pointer',
                background: 'white',
              }}>
                <h3>{project.name}</h3>
                <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>{project.slug}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
