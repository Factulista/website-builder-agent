'use client'

import { useState } from 'react'

export default function ProjectPage({ params }: { params: { id: string } }) {
  const [messages, setMessages] = useState<{ id: string; role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    setMessages([
      ...messages,
      { id: `msg_${Date.now()}`, role: 'user', content: input },
    ])
    setInput('')

    // Simulated response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: '🚀 Building your website... (Coming soon)',
        },
      ])
    }, 1000)
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh', gap: 0 }}>
      <div style={{ borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', fontWeight: 'bold' }}>
          Project: {params.id}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '2rem' }}>
              👋 Describe your website
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '80%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                  color: msg.role === 'user' ? 'white' : '#1f2937',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSendMessage}
          style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '0.5rem' }}
        >
          <input
            type="text"
            placeholder="Describe your website..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ flex: 1, padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}
          />
          <button type="submit">Send</button>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', background: 'white' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.875rem', color: '#6b7280' }}>
          Preview: {params.id}.preview.tuapiattaforma.com
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
          🔄 Preview coming soon...
        </div>
      </div>
    </main>
  )
}
