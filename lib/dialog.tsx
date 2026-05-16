'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type DialogOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

type ActiveDialog = DialogOptions & {
  type: 'confirm' | 'alert'
  resolve: (val: boolean) => void
}

let dialogListener: ((d: ActiveDialog) => void) | null = null

export function confirmDialog(opts: DialogOptions | string): Promise<boolean> {
  const options: DialogOptions = typeof opts === 'string' ? { message: opts } : opts
  return new Promise(resolve => {
    if (dialogListener) dialogListener({ ...options, type: 'confirm', resolve })
    else resolve(false)
  })
}

export function alertDialog(opts: Omit<DialogOptions, 'cancelLabel'> | string): Promise<void> {
  const options: DialogOptions = typeof opts === 'string' ? { message: opts } : opts
  return new Promise<void>(resolve => {
    if (dialogListener) dialogListener({ ...options, type: 'alert', resolve: () => resolve() })
    else { window.alert(options.message); resolve() }
  })
}

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  white: '#ffffff',
  dark: '#1a1a1a',
}

export function DialogHost() {
  const [active, setActive] = useState<ActiveDialog | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    dialogListener = d => setActive(d)
    return () => { dialogListener = null }
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!mounted || !active) return null

  const close = (result: boolean) => {
    active.resolve(result)
    setActive(null)
  }

  const isDanger = active.variant === 'danger'
  const confirmLabel = active.confirmLabel || (active.type === 'alert' ? 'OK' : 'Conferma')
  const cancelLabel = active.cancelLabel || 'Annulla'

  return createPortal(
    <div
      onClick={() => close(false)}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100000,
        animation: 'factDialogFadeIn 0.12s ease',
      }}
    >
      <style>{`
        @keyframes factDialogFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes factDialogScaleIn {
          from { opacity: 0; transform: scale(0.96) translateY(4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: '14px',
          maxWidth: '400px', width: '90%',
          padding: '22px 24px 18px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          border: `1px solid ${C.border}`,
          fontFamily: 'inherit',
          animation: 'factDialogScaleIn 0.16s cubic-bezier(0.2, 0.7, 0.3, 1)',
        }}
      >
        {active.title && (
          <h3 style={{
            margin: '0 0 8px', fontSize: '1rem', fontWeight: 600,
            color: C.text, lineHeight: 1.4,
          }}>{active.title}</h3>
        )}
        <p style={{
          margin: 0, fontSize: '0.875rem', color: C.textMuted,
          lineHeight: 1.55, whiteSpace: 'pre-wrap' as const,
        }}>{active.message}</p>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '8px',
          marginTop: '20px',
        }}>
          {active.type === 'confirm' && (
            <button
              type="button"
              onClick={() => close(false)}
              style={{
                background: 'transparent', color: C.textMuted,
                border: `1px solid ${C.border}`, borderRadius: '8px',
                padding: '7px 16px', fontSize: '0.82rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >{cancelLabel}</button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            style={{
              background: isDanger ? '#dc2626' : C.dark,
              color: 'white',
              border: 'none', borderRadius: '8px',
              padding: '7px 16px', fontSize: '0.82rem', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
