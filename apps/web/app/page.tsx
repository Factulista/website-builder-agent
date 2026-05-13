import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: '600px', padding: '2rem' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem' }}>
          Website Builder Agent
        </h1>
        <p style={{ fontSize: '1.25rem', color: '#6b7280', marginBottom: '2rem' }}>
          Create beautiful, SEO-optimized websites with AI
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <Link href="/login">
            <button>Login</button>
          </Link>
          <Link href="/signup">
            <button style={{ background: '#064e3b' }}>Sign Up</button>
          </Link>
        </div>
      </div>
    </main>
  )
}
