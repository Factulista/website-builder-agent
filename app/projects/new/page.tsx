'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { data, error: err } = await supabase
      .from('projects')
      .insert({ name: name.trim(), slug, user_id: session.user.id })
      .select('id')
      .single()

    if (err) { setError(err.message); setLoading(false); return }

    router.push(`/projects/${data.id}`)
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: '480px', padding: '2rem', background: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Nuovo progetto</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>Dai un nome al tuo sito web</p>

        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="text"
            placeholder="Es: Ristorante Da Mario"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '1rem' }}
            autoFocus
          />
          {error && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>}
          <button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creazione...' : 'Crea progetto'}
          </button>
        </form>
      </div>
    </main>
  )
}
