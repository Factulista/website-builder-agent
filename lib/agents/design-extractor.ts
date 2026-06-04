/**
 * Design Extractor — bidirectional sync between agent output and platform Design System.
 *
 * Direction 1 — Agent → Platform:
 *   When the agent generates a new site (create_site), extract typography + palette
 *   from the HTML and write back to siteConfig.designSystem + siteConfig.shared_css.
 *   This populates the visual Design System panel in the platform UI.
 *
 * Direction 2 — Platform → Agent:
 *   The designSystem object is already passed to the agent via richContext.
 *   This module ensures the agent prompt stresses that it MUST use those values.
 *
 * Direction 3 — Media:
 *   When the agent references an image URL that is not in the media library,
 *   track it so the platform can surface it for replacement.
 */

export type TypoConfig = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  color: string
  lineHeight: string
  letterSpacing: string
}

export type DesignSystemExtract = {
  h1: TypoConfig
  h2: TypoConfig
  h3: TypoConfig
  h4: TypoConfig
  h5: TypoConfig
  h6: TypoConfig
  p: TypoConfig
  li: TypoConfig
  a: TypoConfig
  bullet: { symbol: string; size: string }
  /** CSS vars extracted from :root — the authoritative source */
  cssVars: Record<string, string>
  /** Google Font names detected in the HTML */
  googleFonts: string[]
}

const INHERIT = 'inherit'

const DEFAULT_TYPO: TypoConfig = {
  fontFamily: INHERIT,
  fontSize: INHERIT,
  fontWeight: INHERIT,
  color: INHERIT,
  lineHeight: INHERIT,
  letterSpacing: '0',
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS Var extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Extract all :root CSS custom properties from an HTML string. */
export function extractCssVars(html: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const rootBlocks = html.match(/:root\s*\{([^}]+)\}/gi) ?? []
  for (const block of rootBlocks) {
    const inner = block.replace(/:root\s*\{/, '').replace(/\}$/, '')
    const lines = inner.split(';').map(l => l.trim()).filter(Boolean)
    for (const line of lines) {
      const m = line.match(/^(--[\w-]+)\s*:\s*(.+)$/)
      if (m) vars[m[1].trim()] = m[2].trim()
    }
  }
  return vars
}

/** Extract Google Font family names from HTML (from @import or <link> tags). */
export function extractGoogleFonts(html: string): string[] {
  const fonts = new Set<string>()
  // @import url('https://fonts.googleapis.com/css2?family=Inter:wght@...')
  const imports = html.match(/fonts\.googleapis\.com\/css2\?([^'"]+)/gi) ?? []
  for (const imp of imports) {
    const families = imp.match(/family=([^&]+)/gi) ?? []
    for (const f of families) {
      const name = f.replace('family=', '').split(':')[0].replace(/\+/g, ' ')
      if (name) fonts.add(name.trim())
    }
  }
  return [...fonts]
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS property resolution: reads inline CSS rules for semantic tags
// ─────────────────────────────────────────────────────────────────────────────

/** Extract computed CSS for a tag from a raw CSS string. */
function extractTagCSS(css: string, tag: string): Partial<TypoConfig> {
  const result: Partial<TypoConfig> = {}

  // Match all rules for this tag (handles .fact-design-system, scoped, and bare rules)
  // We want only bare tag rules like "h1 { ... }" — not ".foo h1" or "#bar h1"
  const bare = new RegExp(`(?:^|[;{}])\\s*(?:main\\s+)?${tag}\\s*\\{([^}]+)\\}`, 'gi')
  let match: RegExpExecArray | null

  const collected: Record<string, string> = {}
  while ((match = bare.exec(css)) !== null) {
    const inner = match[1]
    const props = inner.split(';').map(s => s.trim()).filter(Boolean)
    for (const prop of props) {
      const [key, ...vals] = prop.split(':')
      if (key && vals.length) collected[key.trim()] = vals.join(':').trim()
    }
  }

  const resolve = (v: string, cssVars: Record<string, string>): string => {
    if (!v) return v
    return v.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/g, (_, name) => cssVars[name] ?? _)
  }

  // Parse known properties — we resolve var() references inline
  // (cssVars are not available here, caller resolves after)
  if (collected['font-family']) result.fontFamily = collected['font-family'].replace(/['"]/g, '').split(',')[0].trim()
  if (collected['font-size'])   result.fontSize   = collected['font-size']
  if (collected['font-weight']) result.fontWeight = collected['font-weight']
  if (collected['color'])       result.color      = collected['color']
  if (collected['line-height']) result.lineHeight = collected['line-height']
  if (collected['letter-spacing']) result.letterSpacing = collected['letter-spacing']

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the Design System from the HTML of a generated page.
 * Reads: :root CSS vars, tag-level CSS rules, Google Fonts.
 *
 * Returns a DesignSystemExtract compatible with the platform's DesignSystem type.
 */
export function extractDesignSystem(html: string): DesignSystemExtract {
  const cssVars = extractCssVars(html)
  const googleFonts = extractGoogleFonts(html)

  // Collect all inline CSS from <style> blocks
  const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []
  const fullCss = styleBlocks.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')

  const resolve = (v: string): string => {
    if (!v) return v
    return v.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/g, (_, name) => cssVars[name] ?? _)
  }

  const build = (tag: string): TypoConfig => {
    const extracted = extractTagCSS(fullCss, tag)
    return {
      fontFamily:    resolve(extracted.fontFamily   ?? INHERIT),
      fontSize:      resolve(extracted.fontSize     ?? INHERIT),
      fontWeight:    resolve(extracted.fontWeight   ?? INHERIT),
      color:         resolve(extracted.color        ?? INHERIT),
      lineHeight:    resolve(extracted.lineHeight   ?? INHERIT),
      letterSpacing: resolve(extracted.letterSpacing ?? '0'),
    }
  }

  // Infer heading font from Google Fonts if font-family not explicit in CSS
  // (agents often define font in :root via CSS vars like --font-heading: 'Syne')
  const headingFontVar = cssVars['--font-heading'] ?? cssVars['--font-title'] ?? cssVars['--heading-font'] ?? ''
  const bodyFontVar    = cssVars['--font-body']    ?? cssVars['--font-base']  ?? cssVars['--body-font']    ?? ''
  const cleanFont = (v: string) => v.replace(/['"]/g, '').split(',')[0].trim()

  const h1 = build('h1')
  const h2 = build('h2')
  const h3 = build('h3')
  const h4 = build('h4')
  const h5 = build('h5')
  const h6 = build('h6')
  const p  = build('p')
  const li = build('li')
  const a  = build('a')

  // Patch: if fontFamily is still 'inherit' but we have a CSS var, use it
  if (h1.fontFamily === INHERIT && headingFontVar) h1.fontFamily = cleanFont(headingFontVar)
  if (h2.fontFamily === INHERIT && headingFontVar) h2.fontFamily = cleanFont(headingFontVar)
  if (h3.fontFamily === INHERIT && headingFontVar) h3.fontFamily = cleanFont(headingFontVar)
  if (p.fontFamily  === INHERIT && bodyFontVar)    p.fontFamily  = cleanFont(bodyFontVar)
  if (li.fontFamily === INHERIT && bodyFontVar)    li.fontFamily = cleanFont(bodyFontVar)

  // Detect accent/text colors from CSS vars as fallback for 'inherit' color
  const accentColor = cssVars['--accent'] ?? cssVars['--color-accent'] ?? cssVars['--primary'] ?? ''
  const textColor   = cssVars['--text']   ?? cssVars['--color-text']   ?? cssVars['--fg']      ?? ''
  if (a.color  === INHERIT && accentColor) a.color  = accentColor
  if (p.color  === INHERIT && textColor)   p.color  = textColor
  if (li.color === INHERIT && textColor)   li.color = textColor

  return {
    h1, h2, h3, h4, h5, h6, p, li, a,
    bullet: { symbol: '•', size: '0.65em' },
    cssVars,
    googleFonts,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Design System → shared_css block
// Mirrors the client-side buildDesignSystemCSSString() in page.tsx
// ─────────────────────────────────────────────────────────────────────────────

const DS_START = '/* fact-design-system:start */'
const DS_END   = '/* fact-design-system:end */'

/**
 * Build the fact-design-system CSS block from a DesignSystemExtract.
 * Injected into shared_css so the agent-generated typography is reflected
 * in the platform's Design System panel.
 */
export function buildDesignSystemBlock(ds: DesignSystemExtract): string {
  const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'a'] as const

  const rule = (tag: typeof tags[number]) => {
    const c = ds[tag]
    const props: string[] = []
    if (c.fontFamily && c.fontFamily !== INHERIT) props.push(`font-family:'${c.fontFamily}',sans-serif`)
    if (tag !== 'a') {
      if (c.fontSize   && c.fontSize   !== INHERIT) props.push(`font-size:${c.fontSize}`)
    }
    if (c.fontWeight && c.fontWeight !== INHERIT) props.push(`font-weight:${c.fontWeight}`)
    if (c.color      && c.color      !== INHERIT) props.push(`color:${c.color}`)
    if (tag !== 'a') {
      if (c.lineHeight    && c.lineHeight    !== INHERIT) props.push(`line-height:${c.lineHeight}`)
      if (c.letterSpacing && c.letterSpacing !== '0')     props.push(`letter-spacing:${c.letterSpacing}`)
    }
    if (!props.length) return ''
    return `${tag}{${props.join(';')}}`
  }

  const cssRules = tags.map(rule).filter(Boolean).join('\n')
  if (!cssRules.trim()) return ''

  // Font @import
  const fontImport = ds.googleFonts.length > 0
    ? `@import url('https://fonts.googleapis.com/css2?${ds.googleFonts.map(f => `family=${f.replace(/ /g,'+')}:wght@300;400;500;600;700;800`).join('&')}&display=swap');\n`
    : ''

  return `${fontImport}${DS_START}\n${cssRules}\n${DS_END}`
}

/**
 * Merge a new design system block into existing shared_css.
 * Replaces any previous fact-design-system block, preserves the rest.
 */
export function mergeDesignSystemIntoSharedCss(
  existingSharedCss: string,
  newDsBlock: string
): string {
  // Strip old DS block
  let stripped = existingSharedCss
    .replace(new RegExp(`${DS_START}[\\s\\S]*?${DS_END}`, 'g'), '')
    .replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);\n?/g, '')
    .trim()

  if (!newDsBlock.trim()) return stripped
  return `${newDsBlock}\n${stripped}`.trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Media tracking: external image URLs referenced in HTML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find all external image URLs in HTML that are NOT in the project's Supabase storage.
 * Returns a list of placeholder/external URLs the agent used.
 */
export function findExternalImages(
  html: string,
  supabaseUrl: string
): string[] {
  const imgTags = html.match(/<img[^>]+src=["']([^"']+)["']/gi) ?? []
  const external: string[] = []
  for (const tag of imgTags) {
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1]
    if (!src) continue
    if (src.startsWith(supabaseUrl)) continue // already in project storage
    if (src.includes('picsum.photos') || src.includes('placeholder') || src.includes('unsplash')) {
      external.push(src) // placeholder — user should replace
    }
  }
  return [...new Set(external)]
}
