'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

// Supabase Auth has project-wide "Bot and Abuse Protection" (captcha) enabled —
// EVERY password sign-in/sign-up/reset request on this Supabase project is
// rejected server-side without a valid captchaToken, regardless of which app
// sent it. The prebuilt <Auth> UI (@supabase/auth-ui-react, used here until
// 2026-08) has no captcha support at all, so this page silently broke the
// moment that project-wide setting was turned on for the customer-facing app.
//
// This is the SAME Turnstile widget ("Factulista Registro" in Cloudflare) used
// on app.factulista.com's login/registro/recuperar-password — its secret is
// what's configured in Supabase → Authentication → Attack Protection. If that
// ever changes, update TURNSTILE_SITE_KEY to match. The widget's Cloudflare
// config must also allow-list whatever host serves this page (myweb.factulista.com)
// or the challenge will fail to render/verify.
const TURNSTILE_SITE_KEY = '0x4AAAAAADKOJ-3kYDeGg6VY'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId?: string) => void
    }
  }
}

type Mode = 'sign_in' | 'sign_up' | 'forgot'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const turnstileRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/projects')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.push('/projects')
    })
    return () => subscription.unsubscribe()
  }, [router])

  // Render the Turnstile widget explicitly (not via data-attributes) so we get a
  // reliable JS callback — React's DOM diffing doesn't play well with Turnstile's
  // implicit auto-render, which expects to own the container markup itself.
  useEffect(() => {
    let cancelled = false
    function renderWidget() {
      if (cancelled || !turnstileRef.current || !window.turnstile || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setCaptchaToken(token),
        'expired-callback': () => setCaptchaToken(''),
        'error-callback': () => setCaptchaToken(''),
      })
    }
    if (window.turnstile) {
      renderWidget()
    } else {
      const existing = document.querySelector('script[data-turnstile]')
      if (!existing) {
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        script.defer = true
        script.setAttribute('data-turnstile', '1')
        script.onload = renderWidget
        document.head.appendChild(script)
      } else {
        existing.addEventListener('load', renderWidget)
      }
    }
    return () => { cancelled = true }
  }, [])

  const resetCaptcha = () => {
    setCaptchaToken('')
    if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
  }

  const handleGoogle = async () => {
    setError('')
    // OAuth doesn't go through Supabase's captcha check (the provider redirect
    // itself is the human check), so this needs no captchaToken.
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/projects` },
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!captchaToken) { setError('Completa la verifica anti-bot prima di continuare.'); return }
    setLoading(true)
    try {
      if (mode === 'sign_in') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email, password, options: { captchaToken },
        })
        if (err) throw err
        router.push('/projects')
      } else if (mode === 'sign_up') {
        const { error: err } = await supabase.auth.signUp({
          email, password, options: { captchaToken },
        })
        if (err) throw err
        setInfo('Controlla la tua email per confermare la registrazione.')
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          captchaToken,
          redirectTo: `${window.location.origin}/login`,
        })
        if (err) throw err
        setInfo("Ti abbiamo inviato un'email per reimpostare la password.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante l'autenticazione")
    } finally {
      setLoading(false)
      resetCaptcha()
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setError('')
    setInfo('')
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '2rem', background: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: 'center' }}>
          Website Builder
        </h1>

        <button
          type="button"
          onClick={handleGoogle}
          style={{ width: '100%', padding: '0.65rem', marginBottom: '1rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', background: 'white', cursor: 'pointer', fontSize: '0.95rem', fontFamily: 'inherit' }}
        >
          Sign in with Google
        </button>

        <div style={{ borderTop: '1px solid #e5e7eb', margin: '1rem 0' }} />

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', color: '#374151' }}>Email</label>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', padding: '0.55rem', marginBottom: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
          {mode !== 'forgot' && (
            <>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', color: '#374151' }}>Password</label>
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '0.55rem', marginBottom: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </>
          )}

          <div ref={turnstileRef} style={{ margin: '0.75rem 0', minHeight: '65px' }} />

          {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}
          {info && <p style={{ color: '#16a34a', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{info}</p>}

          <button
            type="submit" disabled={loading}
            style={{ width: '100%', padding: '0.65rem', background: '#16a34a', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1, fontFamily: 'inherit', fontSize: '0.95rem' }}
          >
            {loading ? '…' : mode === 'sign_in' ? 'Accedi' : mode === 'sign_up' ? 'Registrati' : 'Invia link di recupero'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {mode === 'sign_in' && (
            <>
              <a href="#" onClick={e => { e.preventDefault(); switchMode('forgot') }} style={{ fontSize: '0.85rem', color: '#6b7280' }}>Forgot your password?</a>
              <a href="#" onClick={e => { e.preventDefault(); switchMode('sign_up') }} style={{ fontSize: '0.85rem', color: '#6b7280' }}>Non hai un account? Registrati</a>
            </>
          )}
          {mode !== 'sign_in' && (
            <a href="#" onClick={e => { e.preventDefault(); switchMode('sign_in') }} style={{ fontSize: '0.85rem', color: '#6b7280' }}>Hai già un account? Accedi</a>
          )}
        </div>
      </div>
    </main>
  )
}
