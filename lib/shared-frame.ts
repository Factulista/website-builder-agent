/**
 * Shared header/footer styling — single source of truth.
 *
 * THE PROBLEM
 * -----------
 * Every page injects the SAME nav/footer HTML (shared_nav_html / shared_footer_html),
 * but each page also carries its OWN <style> block. Those per-page stylesheets diverge:
 * e.g. the home page styles `.btn-accent-nav { padding:8px 16px; font-weight:500 }`
 * while a page generated later styles the same class `{ padding:10px 24px; font-weight:600 }`.
 * Because the shared nav uses those classes, the header renders differently per page.
 * Inherited properties (font-family, line-height, color) from each page's <body> leak
 * into the nav too, causing subtle shifts.
 *
 * THE FIX
 * -------
 * Extract — from the canonical home CSS — every rule that styles the shared nav/footer
 * (matched by the element selectors nav/header/footer and by the actual class names used
 * in the shared markup, including rules nested inside @media / @supports). Re-emit them,
 * plus a base rule that pins the home <body> typography onto `nav/header/footer` so
 * inheritance is identical everywhere. This stylesheet is injected AFTER each page's own
 * <style> — equal specificity + later source order means the canonical rules always win,
 * while the page keeps full control of its own body content.
 *
 * This is computed at serve time from shared_css, so it works for every project
 * immediately without any migration or manual re-save.
 */

type Rule = { selector: string; block: string; isAt: boolean }

/** Split CSS into top-level rules, tracking brace depth (handles nested @media blocks). */
function splitTopLevelRules(css: string): Rule[] {
  const rules: Rule[] = []
  let depth = 0
  let segStart = 0
  let braceStart = -1
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') {
      if (depth === 0) braceStart = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && braceStart !== -1) {
        const selector = css.slice(segStart, braceStart).trim()
        const block = css.slice(braceStart + 1, i)
        rules.push({ selector, block, isAt: selector.startsWith('@') })
        segStart = i + 1
        braceStart = -1
      }
    }
  }
  return rules
}

/** Pull one declaration value out of a CSS declaration block. */
function pickDecl(block: string, prop: string): string | undefined {
  const m = block.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m?.[1]?.trim()
}

/**
 * Builds the canonical header/footer stylesheet from the full site CSS.
 *
 * @param navHtml     the shared nav markup (its class names drive rule selection)
 * @param footerHtml  the shared footer markup
 * @param sharedCss   the canonical home page CSS (single source of truth)
 * @returns a CSS string to inject AFTER the page's own styles
 */
export function buildSharedFrameCss(navHtml: string, footerHtml: string, sharedCss: string): string {
  if (!sharedCss) return ''

  // Collect every class name used in the shared nav + footer markup.
  const classes = new Set<string>()
  for (const html of [navHtml, footerHtml]) {
    if (!html) continue
    for (const m of html.matchAll(/class=["']([^"']+)["']/g)) {
      m[1].split(/\s+/).forEach(c => c && classes.add(c))
    }
  }

  // A selector is "frame-relevant" if it targets a nav/header/footer element,
  // a common menu pattern, or any class present in the shared markup.
  const elementRe = /(^|[\s,>+~(])(nav|header|footer)([\s.:,>+~)[]|$)/i
  const patternRe = /hamburger|dropdown|mega[-_]|mobile[-_]?menu|\.menu\b/i
  const isRelevant = (selector: string): boolean => {
    if (elementRe.test(selector) || patternRe.test(selector)) return true
    for (const cls of classes) {
      if (selector.includes('.' + cls)) return true
    }
    return false
  }

  const out: string[] = []

  // 1) Base typography: pin the home <body> base onto nav/header/footer so the
  //    shared frame inherits identical font/line-height/color on every page.
  const bodyBlock = sharedCss.match(/(?:^|[}\s,])body\s*\{([^}]*)\}/i)?.[1] ?? ''
  const baseDecls: string[] = []
  for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing', '-webkit-font-smoothing']) {
    const v = pickDecl(bodyBlock, prop)
    if (v) baseDecls.push(`${prop}:${v}`)
  }
  if (baseDecls.length) {
    out.push(`nav,header,footer{${baseDecls.join(';')}}`)
  }

  // 2) Extract every frame-relevant rule from the canonical CSS, including those
  //    nested inside @media / @supports / @container (responsive nav, mobile menu…).
  const collectRelevant = (block: string): string => {
    const inner: string[] = []
    for (const r of splitTopLevelRules(block)) {
      if (r.isAt || r.selector === ':root') continue
      if (isRelevant(r.selector)) inner.push(`${r.selector}{${r.block.trim()}}`)
    }
    return inner.join('\n')
  }
  for (const r of splitTopLevelRules(sharedCss)) {
    if (r.isAt) {
      const name = r.selector.split(/\s/)[0].toLowerCase()
      if (name === '@media' || name === '@supports' || name === '@container') {
        const inner = collectRelevant(r.block)
        if (inner.trim()) out.push(`${r.selector}{${inner}}`)
      }
      continue
    }
    if (r.selector === ':root') continue
    if (isRelevant(r.selector)) out.push(`${r.selector}{${r.block.trim()}}`)
  }

  return out.join('\n')
}

/**
 * Global layout-stability fix injected on every served page.
 * `scrollbar-gutter: stable` reserves the scrollbar gutter even when a page does
 * not scroll, so a `position:fixed` header (right:0) doesn't shift horizontally
 * between pages that scroll and pages that don't — the "header moves slightly" bug.
 */
export const FRAME_GLOBAL_FIX = 'html{scrollbar-gutter:stable}'
