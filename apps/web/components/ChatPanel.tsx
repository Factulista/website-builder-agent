'use client'

import { useState, useRef, useEffect } from 'react'
import axios from 'axios'

interface ChatPanelProps {
  projectId: string
  onPreviewUpdate: (url: string) => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function ChatPanel({ projectId, onPreviewUpdate }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    // Add user message
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      // TODO: Create conversation if not exists
      const convId = 'conv-123'

      // Send message to backend
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/conversations/${convId}/messages`,
        { content: input }
      )

      const { stream_url } = response.data

      // Open SSE stream
      const eventSource = new EventSource(stream_url)

      let assistantContent = ''

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === 'agent_started') {
          assistantContent += `\n🔄 ${data.agent}...`
        } else if (data.type === 'agent_complete') {
          assistantContent += ` ✓\n`
        }

        // Update assistant message
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...last, content: assistantContent },
            ]
          }
          return prev
        })
      }

      eventSource.onerror = () => {
        eventSource.close()
        setLoading(false)
      }

      // Add initial assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_asst`,
        role: 'assistant',
        content: '🤖 Processing...',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages Container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#9ca3af',
            paddingTop: '2rem',
          }}>
            <p>👋 Start by telling me what you want to build</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              display: 'flex',
              justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                background: message.role === 'user' ? '#2563eb' : '#f3f4f6',
                color: message.role === 'user' ? 'white' : '#1f2937',
                fontSize: '0.95rem',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
              }}
            >
              {message.content}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSendMessage}
        style={{
          padding: '1rem',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          gap: '0.5rem',
        }}
      >
        <input
          type="text"
          placeholder="Describe your website..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: '1px solid #e5e7eb',
            borderRadius: '0.375rem',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '0.75rem 1.5rem',
            background: loading ? '#9ca3af' : '#2563eb',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '⏳' : 'Send'}
        </button>
      </form>
    </div>
  )
}
