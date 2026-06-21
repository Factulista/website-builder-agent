/**
 * A Block is one structural unit of a page (nav, hero section, footer, style tag…).
 * Blocks are the atomic unit for editing — the agent reads and writes one block
 * at a time instead of the whole page HTML, keeping token cost low and blast
 * radius small.
 *
 * `html` is the raw HTML of just this block (e.g. the full <section id="hero">…</section>).
 * `id`  is a stable UUID that never changes even when the block is edited.
 * `type` groups blocks for UI purposes (e.g. "style" blocks go in <head>).
 */
export type Block = {
  id: string
  type: 'style' | 'nav' | 'header' | 'section' | 'footer' | 'script' | 'other'
  selector: string   // CSS selector that uniquely identifies this block, e.g. "section#hero"
  html: string       // full raw HTML of this block
  order: number      // position in page (0-based)
}

/** Shared domain types used across components and pages */
export type Page = {
  slug: string
  name: string
  html: string
  /** Structured blocks — source of truth when present.
   *  `html` is kept as assembled cache for serve/legacy. */
  blocks?: Block[]
  /** Label shown in the site navigation menu (defaults to name) */
  menuLabel?: string
  /** Whether this page appears in the nav menu (defaults to true) */
  inMenu?: boolean
  /** OG image URL for this page */
  og_image?: string
  /** Custom Open Graph title override (defaults to the page <title>) */
  og_title?: string
  /** Per-page robots directive (Pages panel). Default: index, follow. */
  robots?: { noindex?: boolean; nofollow?: boolean }
  /** Mega-menu dropdown this page appears in (e.g. 'funcionalidades'). Builder-managed. */
  megaMenu?: string
  /** Display label inside the mega menu panel (overrides name/menuLabel). */
  megaMenuLabel?: string
}
