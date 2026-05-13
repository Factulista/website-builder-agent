'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ProjectsPage() {
  const [projects] = useState([
    { id: '1', name: 'My Website', slug: 'my-website', created_at: '2026-05-13' },
  ])

  return (
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1>My Projects</h1>
        <Link href="/projects/new">
          <button>Create Project</button>
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <div style={{
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              padding: '1.5rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: 'white',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.boxShadow = 'none'
            }}>
              <h3>{project.name}</h3>
              <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>{project.slug}</p>
              <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginTop: '1rem' }}>
                Created {new Date(project.created_at).toLocaleDateString()}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  )
}
