/**
 * Design System — single source of truth for typography CSS generation.
 *
 * Used by BOTH:
 *   - client (app/projects/[id]/page.tsx) — the DS panel + saveDesignSystem
 *   - server (blog serve routes) — to render blog post typography
 *
 * CRITICAL: The Design System is stored in site_config.designSystem (the
 * structured object). This object is the AUTHORITATIVE source. The DS block
 * inside shared_css is a derived cache. Blog rendering must generate CSS
 * directly from site_config.designSystem via buildBlogDsBlock() — never by
 * string-parsing shared_css — to guarantee the panel and the blog never diverge.
 */

export type TypoConfig = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  color: string
  lineHeight: string
  letterSpacing: string
}

export type BulletConfig = { symbol: string; size: string }

export type DesignSystem = {
  h1: TypoConfig; h2: TypoConfig; h3: TypoConfig; h4: TypoConfig
  h5: TypoConfig; h6: TypoConfig; p: TypoConfig; li: TypoConfig; a: TypoConfig
  bullet: BulletConfig
}

export const DEFAULT_DESIGN_SYSTEM: DesignSystem = {
  h1: { fontFamily: 'inherit', fontSize: '2.2rem',  fontWeight: '700', color: '#1a1a1a', lineHeight: '1.2',  letterSpacing: '-0.02em' },
  h2: { fontFamily: 'inherit', fontSize: '1.8rem',  fontWeight: '700', color: '#1a1a1a', lineHeight: '1.25', letterSpacing: '-0.01em' },
  h3: { fontFamily: 'inherit', fontSize: '1.4rem',  fontWeight: '600', color: '#1a1a1a', lineHeight: '1.3',  letterSpacing: '0' },
  h4: { fontFamily: 'inherit', fontSize: '1.15rem', fontWeight: '600', color: '#1a1a1a', lineHeight: '1.35', letterSpacing: '0' },
  h5: { fontFamily: 'inherit', fontSize: '1rem',    fontWeight: '600', color: '#374151', lineHeight: '1.4',  letterSpacing: '0' },
  h6: { fontFamily: 'inherit', fontSize: '0.9rem',  fontWeight: '600', color: '#374151', lineHeight: '1.4',  letterSpacing: '0' },
  p:  { fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: '400', color: '#374151', lineHeight: '1.7',  letterSpacing: '0' },
  li: { fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: '400', color: '#374151', lineHeight: '1.7',  letterSpacing: '0' },
  a:  { fontFamily: 'inherit', fontSize: 'inherit', fontWeight: '500', color: '#2563eb', lineHeight: 'inherit', letterSpacing: '0' },
  bullet: { symbol: '•', size: '0.65em' },
}

export const DS_START = '/* fact-design-system:start */'
export const DS_END   = '/* fact-design-system:end */'

const SYSTEM_FONTS = new Set(['Georgia', 'Times New Roman', 'Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Courier New'])

/**
 * Generate the Design System CSS rules + the list of Google Font families used.
 * Emits both bare tag rules (h1{…}) and .blog-post-content-scoped rules.
 * MUST stay identical to the client version (this is the shared canonical one).
 */
export function generateDesignSystemCSS(ds: DesignSystem): { rules: string; fontFamilies: string[] } {
  const googleFonts = new Set<string>()
  const rule = (tag: string, c: TypoConfig) => {
    const props: string[] = []
    if (c.fontFamily && c.fontFamily !== 'inherit') {
      if (!SYSTEM_FONTS.has(c.fontFamily)) googleFonts.add(c.fontFamily)
      props.push(`font-family:'${c.fontFamily}',sans-serif`)
    }
    if (tag !== 'a') {
      if (c.fontSize && c.fontSize !== 'inherit') props.push(`font-size:${c.fontSize}`)
    }
    if (c.fontWeight && c.fontWeight !== 'inherit') props.push(`font-weight:${c.fontWeight}`)
    if (c.color && c.color !== 'inherit') props.push(`color:${c.color}`)
    if (tag !== 'a') {
      if (c.lineHeight && c.lineHeight !== 'inherit') props.push(`line-height:${c.lineHeight}`)
      if (c.letterSpacing && c.letterSpacing !== '0' && c.letterSpacing !== 'inherit') props.push(`letter-spacing:${c.letterSpacing}`)
    }
    if (!props.length) return ''
    const base = `${tag}{${props.join(';')}}`
    const blogTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li'])
    const blogRule = blogTags.has(tag) ? `.blog-post-content ${tag}{${props.join(';')}}` : ''
    const divRule = tag === 'p' ? `.blog-post-content div{${props.join(';')}}` : ''
    const liSpanRule = tag === 'li' ? `.blog-post-content li span,.blog-post-content li b,.blog-post-content li strong{font-size:inherit;color:inherit}` : ''
    return [base, blogRule, divRule, liSpanRule].filter(Boolean).join('\n')
  }
  const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'a'] as const
  const cssRules = tags.map(t => rule(t, ds[t])).filter(Boolean).join('\n')
  const b = ds.bullet ?? DEFAULT_DESIGN_SYSTEM.bullet
  const bulletRule = `.blog-post-content ul>li::before{content:"${b.symbol}";font-size:${b.size}}`
  return { rules: cssRules + '\n' + bulletRule, fontFamilies: [...googleFonts] }
}

/** Build the @import font URL for a list of Google Font families (empty string if none). */
export function buildFontImport(fontFamilies: string[]): string {
  if (fontFamilies.length === 0) return ''
  const families = fontFamilies.map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800`).join('&')
  return `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n`
}

/** Build async <link> tags for Google Fonts (better FCP than @import). */
export function buildAsyncFontLinks(fontFamilies: string[]): string {
  if (fontFamilies.length === 0) return ''
  const families = fontFamilies.map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800`).join('&')
  const url = `https://fonts.googleapis.com/css2?${families}&display=swap`
  return `<link rel="stylesheet" href="${url}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${url}"></noscript>`
}

/**
 * Full DS CSS string with @import at top — used for the shared_css cache block
 * (wrapped between DS_START/DS_END markers by the caller).
 */
export function buildDesignSystemCSSString(ds: DesignSystem): string {
  const { rules, fontFamilies } = generateDesignSystemCSS(ds)
  if (!rules.trim()) return ''
  return buildFontImport(fontFamilies) + rules
}

/**
 * Build the blog post DS override block — async font links + scoped <style>.
 * Generated DIRECTLY from the authoritative designSystem object so the blog
 * always matches the panel, regardless of shared_css state.
 *
 * Injected LAST in the blog post <head> (after BLOG_POST_CONTENT_CSS) so it
 * wins on source order at equal specificity.
 */
export function buildBlogDsBlock(ds: DesignSystem): string {
  const { rules, fontFamilies } = generateDesignSystemCSS(ds)
  if (!rules.trim()) return ''
  const asyncFonts = buildAsyncFontLinks(fontFamilies)
  return `${asyncFonts}\n<style>${rules}</style>`
}

/**
 * Rebuild shared_css with the DS block regenerated from the authoritative
 * designSystem object. Strips any existing DS block + stale font @imports,
 * then prepends the fresh font import + DS block.
 * Keeps the rest of shared_css (component CSS, :root vars) intact.
 */
export function syncSharedCssWithDesignSystem(existingSharedCss: string, ds: DesignSystem): string {
  const { rules, fontFamilies } = generateDesignSystemCSS(ds)
  let stripped = existingSharedCss
    .replace(new RegExp(`${escapeRegex(DS_START)}[\\s\\S]*?${escapeRegex(DS_END)}`, 'g'), '')
    .replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);\n?/g, '')
    .trim()
  if (!rules.trim()) return stripped
  const fontImport = buildFontImport(fontFamilies)
  return `${fontImport}${DS_START}\n${rules}\n${DS_END}\n${stripped}`.trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Merge two :root blocks. The PAGE's own variables win on collision (keep the
 * page's design intact); the shared block only fills in variables the page does
 * NOT define. Returns a single `:root{...}` block.
 *
 * CRITICAL: this replaces the old behaviour that REPLACED a self-contained page's
 * :root wholesale with the shared one — which wiped page-specific variables
 * (--yellow, --black, --radius, …), breaking the page's design at publish.
 */
export function mergeRootVars(pageRootBlock: string, sharedRootBlock: string): string {
  const parse = (block: string): Record<string, string> => {
    const inner = block.replace(/:root\s*\{/i, '').replace(/\}\s*$/, '')
    const vars: Record<string, string> = {}
    // Split on ; but respect that values may contain () — declarations are simple here
    for (const decl of inner.split(';')) {
      const m = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/)
      if (m) vars[m[1]] = m[2].trim()
    }
    return vars
  }
  const shared = parse(sharedRootBlock)
  const page = parse(pageRootBlock)
  // Page wins on collision; shared adds only missing tokens.
  const merged: Record<string, string> = { ...shared, ...page }
  const body = Object.entries(merged).map(([k, v]) => `${k}:${v}`).join(';')
  return `:root{${body}}`
}

/**
 * Remove ALL Design System marker blocks from a CSS string (global).
 * Over time shared_css can accumulate multiple stacked DS blocks (different
 * historical versions). If only the first is stripped, the stale ones leak
 * into the rendered CSS and override the authoritative block by source order.
 * This removes every `DS_START … DS_END` block plus stale Google Font @imports.
 */
export function stripDesignSystemBlocks(css: string): string {
  if (!css) return ''
  return css
    .replace(new RegExp(`${escapeRegex(DS_START)}[\\s\\S]*?${escapeRegex(DS_END)}`, 'g'), '')
    .replace(/@import\s+url\(['"]https:\/\/fonts\.googleapis\.com[^'"]*['"]\)[^;]*;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
