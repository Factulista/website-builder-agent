'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ProjectsPage() {
  const [projects] = useState([
    { id: '1', name: 'My First Website', slug: 'my-first-site', created_at: '2026-05-13' },
  ])

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>My Projects</h1>
        <Link href="/projects/new">
          <button>New Project</button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#9ca3af' }}>No projects yet</p>
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
