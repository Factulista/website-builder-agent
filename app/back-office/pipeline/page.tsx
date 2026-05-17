'use client'

import Link from 'next/link'
import { AGENTS_MANIFEST, PIPELINE_FLOW, PIPELINE_EDGES } from '../../../lib/agents/manifest'

const C = {
  bg: '#faf9f7',
  border: '#e8e4de',
  borderStrong: '#c4bfb8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
}

// Canvas dimensions
const COL_WIDTH = 220
const ROW_HEIGHT = 130
const NODE_WIDTH = 180
const NODE_HEIGHT = 84
const PADDING = 60
const MAX_COL = Math.max(...PIPELINE_FLOW.map(n => n.column))
const MAX_ROW = Math.max(...PIPELINE_FLOW.map(n => n.row))
const CANVAS_W = (MAX_COL + 1) * COL_WIDTH + PADDING * 2
const CANVAS_H = (MAX_ROW + 1) * ROW_HEIGHT + PADDING * 2

const nodePos = (col: number, row: number) => ({
  x: PADDING + col * COL_WIDTH,
  y: PADDING + row * ROW_HEIGHT,
})

const nodeCenter = (col: number, row: number) => {
  const p = nodePos(col, row)
  return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 }
}

export default function PipelinePage() {
  // Modifier/utility agents shown separately
  const otherAgents = AGENTS_MANIFEST.filter(a => !PIPELINE_FLOW.some(p => p.id === a.name))

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1200px' }}>
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text }}>Pipeline</h1>
      <p style={{ margin: '6px 0 24px', fontSize: '0.88rem', color: C.textMuted }}>
        Flusso degli agenti per la generazione di un nuovo sito. Le frecce indicano dipendenze di dati.
      </p>

      {/* Canvas */}
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px', overflowX: 'auto', marginBottom: '28px' }}>
        <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', minWidth: '100%' }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={C.borderStrong} />
            </marker>
          </defs>

          {/* Edges */}
          {PIPELINE_EDGES.map((edge, i) => {
            const from = PIPELINE_FLOW.find(n => n.id === edge.from)
            const to = PIPELINE_FLOW.find(n => n.id === edge.to)
            if (!from || !to) return null
            const fromPos = nodePos(from.column, from.row)
            const toPos = nodePos(to.column, to.row)
            const fromX = fromPos.x + NODE_WIDTH
            const fromY = fromPos.y + NODE_HEIGHT / 2
            const toX = toPos.x
            const toY = toPos.y + NODE_HEIGHT / 2
            // Bezier curve
            const midX = (fromX + toX) / 2
            const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
            return (
              <path
                key={i}
                d={path}
                stroke={C.borderStrong}
                strokeWidth={1.5}
                fill="none"
                markerEnd="url(#arrow)"
              />
            )
          })}

          {/* Nodes */}
          {PIPELINE_FLOW.map(node => {
            const pos = nodePos(node.column, node.row)
            const agent = AGENTS_MANIFEST.find(a => a.name === node.id)
            const isOptional = 'optional' in node && node.optional
            return (
              <g key={node.id}>
                <a href={`/back-office/agents/${node.id}`}>
                  <rect
                    x={pos.x} y={pos.y}
                    width={NODE_WIDTH} height={NODE_HEIGHT}
                    rx={10} ry={10}
                    fill={C.white}
                    stroke={isOptional ? '#cbd5e1' : C.text}
                    strokeWidth={isOptional ? 1 : 1.5}
                    strokeDasharray={isOptional ? '5 4' : 'none'}
                    style={{ cursor: 'pointer' }}
                  />
                  <text
                    x={pos.x + NODE_WIDTH / 2} y={pos.y + 30}
                    textAnchor="middle"
                    fontSize="14" fontWeight="600"
                    fill={C.text}
                    style={{ fontFamily: 'inherit' }}
                  >{node.label.split('\n')[0]}</text>
                  {node.label.includes('\n') && (
                    <text
                      x={pos.x + NODE_WIDTH / 2} y={pos.y + 47}
                      textAnchor="middle"
                      fontSize="10"
                      fill={C.textFaint}
                      style={{ fontFamily: 'inherit' }}
                    >{node.label.split('\n')[1]}</text>
                  )}
                  <text
                    x={pos.x + NODE_WIDTH / 2} y={pos.y + NODE_HEIGHT - 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill={C.textFaint}
                    style={{ fontFamily: 'ui-monospace, monospace' }}
                  >{agent?.model.replace('claude-', '').replace('-20251001', '') || ''}</text>
                </a>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', fontSize: '0.78rem', color: C.textMuted }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '12px', border: `1.5px solid ${C.text}`, borderRadius: '3px' }} />
          Step obbligatorio
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ display: 'inline-block', width: '20px', height: '12px', border: '1px dashed #cbd5e1', borderRadius: '3px' }} />
          Step condizionale
        </div>
      </div>

      {/* Other agents */}
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 600, color: C.text }}>Altri agenti</h2>
        <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: C.textMuted }}>
          Non parte della pipeline di creazione iniziale — invocati in modifiche puntuali o background.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {otherAgents.map(a => (
            <Link
              key={a.name}
              href={`/back-office/agents/${a.name}`}
              style={{
                background: C.white, border: `1px solid ${C.border}`,
                borderRadius: '8px', padding: '10px 12px',
                textDecoration: 'none', color: C.text,
                fontSize: '0.85rem',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>{a.displayName}</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: C.textFaint, textTransform: 'capitalize' }}>{a.category}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
