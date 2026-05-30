'use client'

import React, { useState, useRef, useCallback } from 'react'

type CanvasMessage = { role: 'user' | 'assistant'; content: string }

interface ComponentCanvasProps {
  projectId: string
  designTokensCss: string
  /** Called when the user clicks "Inserisci in pagina" */
  onInsert: (html: string) => void
  onClose: () => void
}

const C = {
  bg: '#faf9f7',
  white: '#ffffff',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  blue: '#2563eb',
  dark: '#1a1a1a',
  green: '#16a34a',
}

export function ComponentCanvas({ projectId, designTokensCss, onInsert, onClose }: ComponentCanvasProps) {
  const [messages, setMessages] = useState<CanvasMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null)
  const [attachedImage, setAttachedImage] = useState<{ base64: { data: string; media_type: string }; previewUrl: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasStyleMemory, setHasStyleMemory] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleAttachImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const base64 = dataUrl.split(',')[1]
      setAttachedImage({
        base64: { data: base64, media_type: file.type },
        previewUrl: dataUrl,
      })
    }
    reader.readAsDataURL(file)
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = input.trim()
    if (!msg && !attachedImage) return
    if (loading) return

    const userMsg: CanvasMessage = { role: 'user', content: msg || '(immagine allegata)' }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachedImage(null)
    setLoading(true)
    setError(null)
    setGeneratedHtml(null)
    setShowPreview(false)

    try {
      const res = await fetch('/api/component', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: msg,
          designTokensCss,
          imageBase64: attachedImage?.base64 ?? undefined,
        }),
      })

      const data = await res.json() as { html?: string; summary?: string; error?: string; hasStyleMemory?: boolean }
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Errore ${res.status}`)
      }
      if (data.hasStyleMemory !== undefined) setHasStyleMemory(data.hasStyleMemory)

      setGeneratedHtml(data.html ?? '')
      setShowPreview(true)
      setMessages(prev => [...prev, { role: 'assistant', content: data.summary ?? 'Blocco generato.' }])
    } catch (err) {
      setError(String(err))
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${String(err)}` }])
    } finally {
      setLoading(false)
    }
  }, [input, attachedImage, loading, projectId, designTokensCss])

  const previewSrc = generatedHtml
    ? `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}body{padding:0;background:var(--color-bg,#fff);font-family:var(--font-body,sans-serif)}${designTokensCss}</style></head><body>${generatedHtml}</body></html>`)}`
    : ''

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 99, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '460px', maxWidth: '95vw',
        background: C.white,
        boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
        zIndex: 100,
        display: 'flex', flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: C.bg,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: C.text }}>⊞ Crea un blocco</span>
              {hasStyleMemory && (
                <span style={{
                  fontSize: '0.68rem', fontWeight: 500,
                  background: '#f0fdf4', color: '#16a34a',
                  border: '1px solid #bbf7d0',
                  borderRadius: '20px', padding: '1px 7px',
                }}>
                  ✦ Stile memorizzato
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: C.textFaint, marginTop: '2px' }}>
              {hasStyleMemory
                ? 'I nuovi blocchi seguiranno lo stile dei precedenti'
                : 'Progetta un componente in isolamento, poi inseriscilo nel sito'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: '6px', width: '28px', height: '28px',
              cursor: 'pointer', fontSize: '1rem', color: C.textMuted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px',
          display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
          {messages.length === 0 && (
            <div style={{ color: C.textFaint, fontSize: '0.82rem', lineHeight: 1.6, padding: '8px 0' }}>
              <p style={{ marginBottom: '10px' }}>Descrivi il blocco che vuoi creare, ad esempio:</p>
              {[
                '"Una sezione pricing con 3 piani"',
                '"Un hero minimalista con H1 e CTA"',
                '"Una griglia di 4 testimonial con avatar"',
                '"Una sezione FAQ con accordion"',
              ].map(ex => (
                <button
                  key={ex}
                  onClick={() => setInput(ex.replace(/"/g, ''))}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: C.bg, border: `1px solid ${C.border}`,
                    borderRadius: '8px', padding: '7px 10px', marginBottom: '6px',
                    fontSize: '0.8rem', color: C.textMuted, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {ex}
                </button>
              ))}
              <p style={{ marginTop: '8px', fontSize: '0.78rem' }}>
                💡 Puoi anche allegare un'immagine o mockup come riferimento visivo
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
            }}>
              <div style={{
                background: m.role === 'user' ? C.dark : C.bg,
                color: m.role === 'user' ? '#fff' : C.text,
                borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                padding: '8px 12px',
                fontSize: '0.82rem',
                border: m.role === 'assistant' ? `1px solid ${C.border}` : 'none',
                lineHeight: 1.5,
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ alignSelf: 'flex-start' }}>
              <div style={{
                background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: '12px 12px 12px 4px',
                padding: '8px 14px', fontSize: '0.82rem', color: C.textFaint,
              }}>
                ⏳ Generando il blocco…
              </div>
            </div>
          )}
        </div>

        {/* Preview */}
        {showPreview && generatedHtml && (
          <div style={{
            flexShrink: 0, borderTop: `1px solid ${C.border}`,
            background: C.bg,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px 8px',
            }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 500, color: C.textMuted }}>Anteprima</span>
              <button
                onClick={() => setShowPreview(v => !v)}
                style={{
                  background: 'transparent', border: 'none',
                  fontSize: '0.75rem', color: C.blue, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {showPreview ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
            <div style={{
              height: '220px', overflow: 'hidden',
              borderTop: `1px solid ${C.border}`,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <iframe
                src={previewSrc}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                sandbox="allow-scripts"
                title="Anteprima blocco"
              />
            </div>
            <div style={{ padding: '10px 16px' }}>
              <button
                onClick={() => onInsert(generatedHtml)}
                style={{
                  width: '100%', background: C.green, color: 'white',
                  border: 'none', borderRadius: '8px',
                  padding: '9px 0', fontSize: '0.85rem', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ✓ Inserisci in pagina
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            margin: '0 16px 8px', padding: '8px 12px',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '8px', fontSize: '0.78rem', color: '#dc2626',
            flexShrink: 0,
          }}>
            {error}
          </div>
        )}

        {/* Input */}
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${C.border}`,
          padding: '12px 14px', background: C.white,
        }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAttachImage(f); e.target.value = '' }}
          />
          {attachedImage && (
            <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachedImage.previewUrl} alt="ref" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', border: `1px solid ${C.border}` }} />
              <span style={{ fontSize: '0.75rem', color: C.textFaint }}>Immagine come riferimento di design</span>
              <button
                onClick={() => setAttachedImage(null)}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '1rem' }}
              >×</button>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{
              background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: '10px', overflow: 'hidden',
            }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent) }
                }}
                placeholder="Descrivi il blocco da creare…"
                disabled={loading}
                rows={1}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  fontSize: '0.875rem', padding: '10px 12px 6px',
                  background: 'transparent', color: C.text,
                  resize: 'none', overflow: 'hidden', lineHeight: 1.5,
                  fontFamily: 'inherit', display: 'block', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  style={{
                    background: 'transparent', color: C.textFaint, border: `1px solid ${C.border}`,
                    padding: '4px 9px', fontSize: '0.75rem', borderRadius: '6px',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  📎 Immagine
                </button>
                <button
                  type="submit"
                  disabled={loading || (!input.trim() && !attachedImage)}
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (input.trim() || attachedImage) && !loading ? C.dark : '#d6d3d1',
                    color: 'white', border: 'none', fontSize: '0.85rem',
                    cursor: (input.trim() || attachedImage) && !loading ? 'pointer' : 'not-allowed',
                  }}
                >
                  {loading ? '⏳' : '↑'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
