'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Tab = { href: string; label: string; match: (pathname: string) => boolean }

const TABS: Tab[] = [
  { href: '/back-office/agents',   label: 'Agents List',     match: p => p === '/back-office/agents' || p.startsWith('/back-office/agents/') },
  { href: '/back-office/pipeline', label: 'Agents Workflow', match: p => p.startsWith('/back-office/pipeline') },
  { href: '/back-office/runs',     label: 'Agents Run',      match: p => p.startsWith('/back-office/runs') },
]

const C = {
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  border: '#e8e4de',
  borderStrong: '#1a1a1a',
  bg: '#faf9f7',
}

export function AgentsTabs() {
  const pathname = usePathname() ?? ''

  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      borderBottom: `1px solid ${C.border}`,
      padding: '0 40px',
      marginTop: '-8px', // compensa il padding-top tipico delle pagine
      marginBottom: '8px',
      background: C.bg,
    }}>
      {TABS.map(tab => {
        const active = tab.match(pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: '14px 18px',
              textDecoration: 'none',
              color: active ? C.text : C.textMuted,
              fontSize: '0.88rem',
              fontWeight: active ? 600 : 500,
              borderBottom: `2px solid ${active ? C.borderStrong : 'transparent'}`,
              marginBottom: '-1px',
              transition: 'color 0.12s, border-color 0.12s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              if (!active) (e.currentTarget as HTMLElement).style.color = C.text
            }}
            onMouseLeave={e => {
              if (!active) (e.currentTarget as HTMLElement).style.color = C.textMuted
            }}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
