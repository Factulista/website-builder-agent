'use client'

import { useState, useRef, useEffect } from 'react'
import ChatPanel from '@/components/ChatPanel'

export default function ProjectPage({ params }: { params: { id: string } }) {
  const [preview, setPreview] = useState('about:blank')

  return (
    <main style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      height: '100vh',
      gap: 0,
    }}>
      {/* Chat Panel */}
      <div style={{
        borderRight: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <ChatPanel projectId={params.id} onPreviewUpdate={setPreview} />
      </div>

      {/* Preview Panel */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'white',
      }}>
        <div style={{
          padding: '1rem',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '0.875rem',
          color: '#6b7280',
        }}>
          Preview: {params.id}.preview.tuapiattaforma.com
        </div>
        <iframe
          src={preview}
          style={{
            flex: 1,
            border: 'none',
            width: '100%',
          }}
        />
      </div>
    </main>
  )
}
