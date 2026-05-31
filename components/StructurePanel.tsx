'use client'

import React, { useMemo, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StructureNode {
  sid: string
  tag: string
  label: string
  badge: string
  badgeColor: string
  children: StructureNode[]
  depth: number
}

export interface StructurePanelProps {
  html: string
  onHtmlChange: (newHtml: string) => void
}

// ─── Tag metadata ─────────────────────────────────────────────────────────────

const SEMANTIC_TAGS = new Set(['header', 'nav', 'main', 'footer', 'section', 'article', 'aside'])
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'figure', 'table', 'form'])
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'meta', 'link', 'base', 'head', 'br', 'hr', 'path', 'svg'])

const TAG_BADGE: Record<string, string> = {
  header: 'HDR', nav: 'NAV', main: 'MAIN', footer: 'FTR',
  section: 'SEC', article: 'ART', aside: 'SIDE', form: 'FORM',
  h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', h5: 'H5', h6: 'H6',
  p: 'P', ul: 'UL', ol: 'OL', blockquote: 'BQ', figure: 'FIG', table: 'TBL',
  div: 'DIV',
}

const TAG_COLOR: Record<string, string> = {
  header: '#7c3aed', footer: '#7c3aed', nav: '#7c3aed',
  main: '#0369a1', section: '#0369a1', article: '#0369a1', aside: '#0369a1', form: '#0369a1',
  h1: '#b45309', h2: '#b45309', h3: '#b45309', h4: '#b45309', h5: '#b45309', h6: '#b45309',
  p: '#374151', ul: '#374151', ol: '#374151', blockquote: '#374151', figure: '#374151',
  div: '#6b7280', table: '#6b7280',
}

// ─── DOM parsing ──────────────────────────────────────────────────────────────

function getLabel(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria.slice(0, 55)

  // First heading inside
  const h = el.querySelector('h1,h2,h3,h4,h5,h6')
  if (h) {
    const t = (h.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 55)
    if (t) return t
  }

  // Text content (truncated)
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 55)
  if (text) return text

  if (el.id) return `#${el.id}`
  const cls = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean)[0]
  if (cls) return `.${cls}`
  return el.tagName.toLowerCase()
}

// Module-level counter — reset before each parse so applyOp can reproduce the same IDs
let _sid = 0

function walkDom(parent: Element, depth: number): StructureNode[] {
  const nodes: StructureNode[] = []
  for (const el of Array.from(parent.children)) {
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) continue

    // Depth-based inclusion rules:
    //   depth 0 → all body children
    //   depth 1 → semantic + text + div
    //   depth 2 → text elements only
    const include =
      depth === 0 ||
      (depth === 1 && (SEMANTIC_TAGS.has(tag) || TEXT_TAGS.has(tag) || tag === 'div')) ||
      (depth === 2 && TEXT_TAGS.has(tag))
    if (!include) continue

    const sid = `s${_sid++}`
    el.setAttribute('data-sid', sid)

    const children = depth < 2 ? walkDom(el, depth + 1) : []

    nodes.push({
      sid,
      tag,
      label: getLabel(el),
      badge: TAG_BADGE[tag] ?? tag.slice(0, 4).toUpperCase(),
      badgeColor: TAG_COLOR[tag] ?? '#6b7280',
      children,
      depth,
    })
  }
  return nodes
}

function parseStructure(html: string): StructureNode[] {
  if (typeof window === 'undefined') return []
  _sid = 0
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return walkDom(doc.body, 0)
}

// ─── HTML mutation ────────────────────────────────────────────────────────────

type Op =
  | { type: 'delete'; sid: string }
  | { type: 'move'; sid: string; refSid: string; where: 'before' | 'after' }

function applyOp(html: string, op: Op): string {
  if (typeof window === 'undefined') return html
  _sid = 0
  const doc = new DOMParser().parseFromString(html, 'text/html')
  walkDom(doc.body, 0) // assigns same sids as parseStructure for this html

  const el = doc.querySelector(`[data-sid="${op.sid}"]`)
  if (!el) return html

  if (op.type === 'delete') {
    el.remove()
  } else {
    const ref = doc.querySelector(`[data-sid="${op.refSid}"]`)
    if (!ref || ref === el) return html
    if (op.where === 'before') {
      ref.parentNode?.insertBefore(el, ref)
    } else {
      ref.parentNode?.insertBefore(el, ref.nextSibling)
    }
  }

  doc.querySelectorAll('[data-sid]').forEach(e => e.removeAttribute('data-sid'))

  const dt = html.match(/<!DOCTYPE[^>]*>/i)?.[0] ?? ''
  return (dt ? dt + '\n' : '') + doc.documentElement.outerHTML
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StructurePanel({ html, onHtmlChange }: StructurePanelProps) {
  const tree = useMemo(() => parseStructure(html), [html])

  const [hovered, setHovered] = useState<string | null>(null)
  const [dragSid, setDragSid] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ sid: string; where: 'before' | 'after' } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleCollapse = useCallback((sid: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(sid) ? next.delete(sid) : next.add(sid)
      return next
    })
  }, [])

  const handleDelete = useCallback((sid: string) => {
    onHtmlChange(applyOp(html, { type: 'delete', sid }))
  }, [html, onHtmlChange])

  const handleDrop = useCallback((targetSid: string) => {
    if (!dragSid || dragSid === targetSid) return
    if (!drop || drop.sid !== targetSid) return
    onHtmlChange(applyOp(html, { type: 'move', sid: dragSid, refSid: targetSid, where: drop.where }))
    setDragSid(null)
    setDrop(null)
  }, [html, onHtmlChange, dragSid, drop])

  const renderNode = useCallback((node: StructureNode): React.ReactNode => {
    const isCollapsed = collapsed.has(node.sid)
    const hasKids = node.children.length > 0
    const isDragged = dragSid === node.sid
    const isTarget = drop?.sid === node.sid

    return (
      <React.Fragment key={node.sid}>
        <div
          draggable
          onMouseEnter={() => setHovered(node.sid)}
          onMouseLeave={() => { if (hovered === node.sid) setHovered(null) }}
          onDragStart={e => { e.stopPropagation(); setDragSid(node.sid) }}
          onDragOver={e => {
            e.preventDefault()
            e.stopPropagation()
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setDrop({ sid: node.sid, where: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
          }}
          onDragLeave={e => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setDrop(null)
            }
          }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(node.sid) }}
          onDragEnd={() => { setDragSid(null); setDrop(null) }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            paddingLeft: 6 + node.depth * 12,
            paddingRight: 4,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: 'grab',
            opacity: isDragged ? 0.3 : 1,
            background: hovered === node.sid ? '#f3f4f6' : 'transparent',
            borderRadius: 4,
            borderTop: isTarget && drop?.where === 'before' ? '2px solid #2563eb' : '2px solid transparent',
            borderBottom: isTarget && drop?.where === 'after' ? '2px solid #2563eb' : '2px solid transparent',
            minHeight: 26,
            userSelect: 'none',
            transition: 'background 0.08s',
          }}
        >
          {/* Drag handle */}
          <span style={{ color: '#d1d5db', fontSize: '0.62rem', flexShrink: 0, lineHeight: 1 }}>⠿</span>

          {/* Expand / collapse toggle */}
          <span
            onClick={() => hasKids && toggleCollapse(node.sid)}
            style={{
              width: 10,
              flexShrink: 0,
              color: '#9ca3af',
              fontSize: '0.5rem',
              cursor: hasKids ? 'pointer' : 'default',
              lineHeight: 1,
              textAlign: 'center',
            }}
          >
            {hasKids ? (isCollapsed ? '▶' : '▼') : ''}
          </span>

          {/* Tag badge */}
          <span style={{
            fontSize: '0.52rem',
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: 'white',
            background: node.badgeColor,
            borderRadius: 3,
            padding: '1px 3px',
            minWidth: 22,
            textAlign: 'center',
            flexShrink: 0,
            fontFamily: 'monospace',
            lineHeight: '1.4',
          }}>
            {node.badge}
          </span>

          {/* Label */}
          <span style={{
            fontSize: '0.72rem',
            color: '#374151',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: '1.3',
          }}>
            {node.label}
          </span>

          {/* Delete button (visible on hover) */}
          <button
            onClick={e => { e.stopPropagation(); handleDelete(node.sid) }}
            title="Elimina elemento"
            style={{
              visibility: hovered === node.sid ? 'visible' : 'hidden',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
              fontSize: '0.82rem',
              padding: '0 3px',
              lineHeight: 1,
              flexShrink: 0,
              fontWeight: 700,
            }}
          >×</button>
        </div>

        {/* Render children unless collapsed */}
        {!isCollapsed && hasKids && node.children.map(renderNode)}
      </React.Fragment>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, hovered, dragSid, drop, handleDelete, handleDrop, toggleCollapse])

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      borderRight: '1px solid #e5e7eb',
      background: '#f9fafb',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '7px 10px',
        borderBottom: '1px solid #e5e7eb',
        fontSize: '0.62rem',
        fontWeight: 700,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        flexShrink: 0,
        background: '#f3f4f6',
      }}>
        Struttura pagina
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 4px 12px' }}>
        {tree.length === 0 ? (
          <p style={{ padding: '14px 10px', fontSize: '0.72rem', color: '#9ca3af', textAlign: 'center', margin: 0 }}>
            Nessun elemento strutturale rilevato
          </p>
        ) : (
          tree.map(renderNode)
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '5px 8px',
        borderTop: '1px solid #e5e7eb',
        fontSize: '0.6rem',
        color: '#9ca3af',
        background: '#f9fafb',
        flexShrink: 0,
      }}>
        ⠿ trascina · × elimina
      </div>
    </div>
  )
}
