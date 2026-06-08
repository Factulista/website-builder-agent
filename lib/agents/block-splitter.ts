/**
 * Block Splitter — Fase 1 core
 *
 * Converts a monolithic page HTML string into an ordered array of Block objects.
 * Each Block is an independently-editable structural unit. The agent reads and
 * writes one block at a time, keeping token cost ~5-15k instead of 73k.
 *
 * Strategy:
 *   1. Extract <style> and <script> tags from <head> → type:'style'/'script'
 *   2. Split <body> by direct structural children:
 *        <nav>, <header>, <footer>, <main>, <section>, <article>, <aside>
 *        and direct <div> children that have an id or class (top-level divs only)
 *   3. Anything not matched becomes type:'other'
 *
 * The split is intentionally simple and robust — perfect splits are less
 * important than stable IDs and correct reassembly.
 *
 * assembleBlocksToHtml() is the inverse: builds back the full page HTML from
 * blocks in order, guaranteed byte-stable on a round-trip if no edits happen.
 */

import { Block } from '../types'

// Works in both Node.js (server) and browser (client component)
const uuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// ── Selectors ────────────────────────────────────────────────────────────────

/** Build a stable CSS selector for a top-level element. */
function elementSelector(tag: string, attrs: string): string {
  const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1]
  if (id) return `${tag}#${id}`
  const cls = attrs.match(/\bclass=["']([^"']+)["']/i)?.[1]?.trim().split(/\s+/)[0]
  if (cls) return `${tag}.${cls}`
  return tag
}

function blockType(tag: string): Block['type'] {
  if (tag === 'nav')    return 'nav'
  if (tag === 'header') return 'header'
  if (tag === 'footer') return 'footer'
  if (tag === 'style')  return 'style'
  if (tag === 'script') return 'script'
  if (tag === 'section' || tag === 'main' || tag === 'article' || tag === 'aside') return 'section'
  return 'other'
}

// ── Head extraction ───────────────────────────────────────────────────────────

/**
 * Pull <style> blocks out of <head> and return them as Blocks.
 * Leaves everything else (meta, title, link) in the head as-is.
 */
function extractHeadBlocks(html: string, startOrder: number): { blocks: Block[]; order: number } {
  const blocks: Block[] = []
  let order = startOrder
  const styleRe = /<style[^>]*>[\s\S]*?<\/style>/gi
  let m: RegExpExecArray | null
  let i = 0
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push({ id: uuid(), type: 'style', selector: `style:nth(${i})`, html: m[0], order: order++ })
    i++
  }
  return { blocks, order }
}

// ── Body splitting ────────────────────────────────────────────────────────────

/** Tags treated as structural top-level blocks. */
const STRUCTURAL_TAGS = new Set(['nav', 'header', 'footer', 'main', 'section', 'article', 'aside'])

/**
 * Walk <body> at ONE level deep and split into blocks.
 * Uses a simple bracket-counter to find the matching close tag, which
 * handles nested elements without a full DOM parser.
 */
function splitBodyIntoBlocks(bodyContent: string, startOrder: number): Block[] {
  const blocks: Block[] = []
  let order = startOrder
  let pos = 0

  while (pos < bodyContent.length) {
    // Skip whitespace between elements
    const wsMatch = bodyContent.slice(pos).match(/^(\s+)/)
    if (wsMatch) { pos += wsMatch[0].length; continue }

    // Try to match an opening tag
    const tagMatch = bodyContent.slice(pos).match(/^<([a-z][a-z0-9]*)([^>]*)>/i)
    if (!tagMatch) {
      // Not an element — collect text/comment until next tag
      const nextTag = bodyContent.indexOf('<', pos + 1)
      const chunk = bodyContent.slice(pos, nextTag === -1 ? bodyContent.length : nextTag)
      if (chunk.trim()) {
        blocks.push({ id: uuid(), type: 'other', selector: `text:${order}`, html: chunk, order: order++ })
      }
      pos = nextTag === -1 ? bodyContent.length : nextTag
      continue
    }

    const tag = tagMatch[1].toLowerCase()
    const attrs = tagMatch[2]
    const openTag = tagMatch[0]
    const isVoid = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag)

    if (isVoid) {
      blocks.push({ id: uuid(), type: 'other', selector: `${tag}:${order}`, html: openTag, order: order++ })
      pos += openTag.length
      continue
    }

    // Is it structural OR a top-level div with id/class?
    const isStructural = STRUCTURAL_TAGS.has(tag)
    const isTopLevelDiv = tag === 'div' && (attrs.includes('id=') || attrs.includes('class='))

    if (isStructural || isTopLevelDiv) {
      // Find matching close tag using bracket counting
      const blockHtml = extractElement(bodyContent, pos, tag)
      if (blockHtml === null) {
        // Malformed — take rest of body as one block
        const rest = bodyContent.slice(pos)
        blocks.push({ id: uuid(), type: 'other', selector: `${tag}:${order}`, html: rest, order: order++ })
        break
      }
      const sel = elementSelector(tag, attrs)
      // Make selector unique if already used
      const existing = blocks.filter(b => b.selector === sel).length
      const finalSel = existing > 0 ? `${sel}:nth(${existing})` : sel
      blocks.push({ id: uuid(), type: blockType(tag), selector: finalSel, html: blockHtml, order: order++ })
      pos += blockHtml.length
    } else {
      // Non-structural top-level element — wrap as 'other'
      const blockHtml = extractElement(bodyContent, pos, tag)
      if (blockHtml === null) { pos += openTag.length; continue }
      blocks.push({ id: uuid(), type: 'other', selector: `${tag}:${order}`, html: blockHtml, order: order++ })
      pos += blockHtml.length
    }
  }
  return blocks
}

/** Extract the full HTML of one element starting at `pos` in `html`. */
function extractElement(html: string, pos: number, tag: string): string | null {
  let depth = 0
  let i = pos
  const openRe = new RegExp(`<${tag}[\\s>]`, 'i')
  const closeRe = new RegExp(`</${tag}>`, 'i')
  while (i < html.length) {
    const sub = html.slice(i)
    const nextOpen  = sub.search(openRe)
    const nextClose = sub.search(closeRe)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i += nextOpen + 1
    } else {
      depth--
      i += nextClose + `</${tag}>`.length
      if (depth <= 0) return html.slice(pos, i)
    }
  }
  return null
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Split a full page HTML string into an ordered Block array.
 * Returns null if the HTML is empty or malformed beyond recovery.
 *
 * The `html` field on each block contains the exact bytes of that block.
 * assembleBlocksToHtml(splitHtmlIntoBlocks(html)) === html (modulo leading/trailing whitespace).
 */
export function splitHtmlIntoBlocks(html: string): Block[] | null {
  if (!html?.trim()) return null

  const blocks: Block[] = []
  let order = 0

  // 1. Extract <style> blocks from <head>
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  if (headMatch) {
    const { blocks: headBlocks, order: nextOrder } = extractHeadBlocks(headMatch[1], order)
    blocks.push(...headBlocks)
    order = nextOrder
  }

  // 2. Split <body> content into structural blocks
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    const bodyBlocks = splitBodyIntoBlocks(bodyMatch[1], order)
    blocks.push(...bodyBlocks)
  } else {
    // No <body> tag — treat whole thing as one block (fallback)
    blocks.push({ id: uuid(), type: 'other', selector: 'root', html, order: 0 })
  }

  return blocks.length > 0 ? blocks : null
}

/**
 * Reassemble a full page HTML from blocks in order.
 * Non-style blocks are injected into the body at their original positions.
 * Style blocks are injected back into <head>.
 *
 * This is called at save time and serve time to build the final HTML.
 */
export function assembleBlocksToHtml(blocks: Block[], originalHtml: string): string {
  if (!blocks.length) return originalHtml

  const styleBlocks = blocks.filter(b => b.type === 'style').sort((a, b) => a.order - b.order)
  const bodyBlocks  = blocks.filter(b => b.type !== 'style').sort((a, b) => a.order - b.order)

  let result = originalHtml

  // Replace <style> blocks in <head>
  if (styleBlocks.length) {
    const assembledStyles = styleBlocks.map(b => b.html).join('\n')
    // Strip old styles from head and replace
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    result = result.replace(/<\/head>/i, `${assembledStyles}\n</head>`)
  }

  // Replace <body> content with reassembled blocks
  if (bodyBlocks.length) {
    const assembledBody = bodyBlocks.map(b => b.html).join('\n')
    result = result.replace(/<body([^>]*)>[\s\S]*?<\/body>/i, `<body$1>\n${assembledBody}\n</body>`)
  }

  return result
}

/**
 * Find a block by selector (exact match or partial match).
 * Used by the agent to resolve a previewSelection.blockSelector to a Block.
 */
export function findBlockBySelector(blocks: Block[], selector: string): Block | null {
  // Exact match first
  const exact = blocks.find(b => b.selector === selector)
  if (exact) return exact
  // Partial: selector contains the block's base tag+id/class
  const partial = blocks.find(b => b.selector.startsWith(selector) || selector.startsWith(b.selector))
  return partial ?? null
}

/**
 * Build a compact block index string for the agent's system prompt.
 * Format: "0 style:0 | 1 nav | 2 section#hero | 3 section#features | ..."
 * ~50 tokens for a 10-block page vs 73k for full HTML.
 */
export function buildBlockIndex(blocks: Block[]): string {
  return blocks
    .sort((a, b) => a.order - b.order)
    .map(b => `[${b.order}] ${b.selector} (${b.type}, ${Math.round(b.html.length / 4)}tok)`)
    .join('\n')
}

/**
 * Apply a validated find/replace to a specific block's HTML.
 * Returns the updated block or null if the find string wasn't found
 * exactly once (prevents ambiguous / missed edits).
 */
export function editBlock(
  block: Block,
  find: string,
  replace: string
): { ok: true; block: Block } | { ok: false; matches: number; hint?: string } {
  const count = block.html.split(find).length - 1
  if (count === 0) {
    const hint = block.html.split('\n').find(l => l.includes(find.trim().slice(0, 20)))?.trim().slice(0, 120)
    return { ok: false, matches: 0, hint }
  }
  if (count > 1) return { ok: false, matches: count }
  return { ok: true, block: { ...block, html: block.html.replace(find, replace) } }
}
