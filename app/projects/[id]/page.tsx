'use client'

import { useState, use, useRef, useEffect } from 'react'

type Message = { id: string; role: 'user' | 'assistant'; content: string }

function extractHtml(content: string): string | null {
  const match = content.match(/```html\n([\s\S]*?)```/)
  return match ? match[1] : null
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: input }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value).split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          const { text } = JSON.parse(line.slice(6))
          full += text
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: full } : m))
          const html = extractHtml(full)
          if (html) setPreviewHtml(html)
        }
      }
    }

    setLoading(false)
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh', gap: 0 }}>
      {/* Chat */}
      <div style={{ borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', fontWeight: 'bold', fontSize: '0.875rem' }}>
          Progetto: {id}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '2rem' }}>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.875rem' }}>Es: "Un sito per il mio ristorante a Milano, elegante e moderno"</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                color: msg.role === 'user' ? 'white' : '#1f2937',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content || (loading && msg.role === 'assistant' ? '...' : '')}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} style={{ padding: '1rem', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            placeholder="Descrivi il tuo sito..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            style={{ flex: 1, padding: '0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? '...' : 'Invia'}
          </button>
        </form>
      </div>

      {/* Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'white' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.875rem', color: '#6b7280' }}>
          Preview
        </div>
        {previewHtml ? (
          <iframe
            srcDoc={previewHtml}
            style={{ flex: 1, border: 'none', width: '100%' }}
            title="Preview"
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
            La preview apparirà qui dopo che l&apos;AI genera il sito
          </div>
        )}
      </div>
    </main>
  )
}
