'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/projects')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) router.push('/projects')
    })

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '2rem', background: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: 'center' }}>
          Website Builder
        </h1>
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          providers={['google']}
          redirectTo={typeof window !== 'undefined' ? `${window.location.origin}/projects` : '/projects'}
          localization={{
            variables: {
              sign_in: { email_label: 'Email', password_label: 'Password', button_label: 'Accedi', link_text: 'Hai già un account? Accedi' },
              sign_up: { email_label: 'Email', password_label: 'Password', button_label: 'Registrati', link_text: 'Non hai un account? Registrati' },
            },
          }}
        />
      </div>
    </main>
  )
}
