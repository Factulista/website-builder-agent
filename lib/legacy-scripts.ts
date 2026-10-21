/**
 * Defuses legacy hamburger-toggle code in stored page HTML without killing the page's other JS.
 *
 * ensureMobileNav injects ONE canonical drawer toggle, so any older toggle baked into a
 * page must stop listening (two listeners on the same click cancel each other out).
 * Older pages, though, often keep that toggle in the same <script> as other page code:
 * the saas2-feature template ships FAQ accordion + tab switcher + hamburger IIFE together,
 * and some generated pages wrap menu, FAQ and pricing toggles in ONE big IIFE. Dropping
 * the whole block (the previous behaviour) silently killed FAQs and tabs on those pages.
 *
 * Strategy per <script> that mentions `hamburgerBtn`:
 *   1. a small, toggle-only IIFE is cut out (whole block dropped if nothing else remains);
 *   2. otherwise the legacy code is pointed at a detached dummy button, so it never fires;
 *   3. if neither yields code that parses, the block is dropped as before.
 */

const NEEDLE = 'hamburgerBtn'
const DUMMY = "(document.getElementById('__legacyHamburger')||document.createElement('button'))"

/** Index just past the `)` matching the `(` at `open`, skipping strings, comments and regex literals. */
function matchParen(src: string, open: number): number {
  let depth = 0
  let prev = '' // last significant char, to tell regex literals from division
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); if (j < 0) return -1; i = j; continue }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) return -1; i = j + 1; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      if (j >= src.length) return -1
      i = j; prev = c; continue
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1, inClass = false
      while (j < src.length && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') j++
        else if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '\n') return -1
        j++
      }
      if (j >= src.length) return -1
      i = j; prev = '/'; continue
    }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i + 1 }
    if (!/\s/.test(c)) prev = c
  }
  return -1
}

/** [start, end) ranges of `(function(){…})();` / `(function(){…}());` expressions. */
function iifeRanges(src: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /\(\s*function\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const close = matchParen(src, m.index)
    if (close < 0) continue
    const tail = /^\s*(?:\(\s*\))?\s*;?/.exec(src.slice(close))
    out.push([m.index, close + (tail ? tail[0].length : 0)])
  }
  return out
}

function parses(code: string): boolean {
  try { new Function(code); return true } catch { return false }
}

// Anything that hints the IIFE does more than open/close the drawer.
const OTHER_FEATURES = /faq|accordion|\btabs?\b|switchTab|pric|billing|fetch\(|submit|turnstile|carousel|slider/i

function cutToggleIife(body: string): string | null {
  const hits = iifeRanges(body).filter(([s, e]) => body.slice(s, e).includes(NEEDLE))
  const innermost = hits.filter(([s, e]) => !hits.some(([s2, e2]) => (s2 !== s || e2 !== e) && s2 >= s && e2 <= e))
  if (innermost.length === 0) return null
  if (innermost.some(([s, e]) => e - s > 2500 || OTHER_FEATURES.test(body.slice(s, e)))) return null
  let rest = body
  for (const [s, e] of [...innermost].sort((a, b) => b[0] - a[0])) rest = rest.slice(0, s) + rest.slice(e)
  return !rest.includes(NEEDLE) && parses(rest) ? rest : null
}

function neutralize(body: string): string | null {
  let out = body
    .replace(/document\.getElementById\(\s*(['"])hamburgerBtn\1\s*\)/g, DUMMY)
    .replace(/document\.querySelector\(\s*(['"])#hamburgerBtn\1\s*\)/g, DUMMY)
    // a menu the legacy code builds itself must not share the canonical panel's id
    .replace(/(\.id\s*=\s*)(['"])mobileMenu\2/g, '$1$2legacyMobileMenu$2')
  if (/(['"])#?hamburgerBtn\1/.test(out)) return null // looked up some other way: can't defuse
  // Bare `hamburgerBtn` would hit the element through window named access.
  if (/\bhamburgerBtn\b/.test(out) && !/\b(?:var|let|const)\s+hamburgerBtn\b/.test(out)) {
    out = `var hamburgerBtn=${DUMMY};\n${out}`
  }
  return parses(out) ? out : null
}

function meaningful(code: string): boolean {
  return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim().length > 0
}

export function stripLegacyHamburgerScripts(html: string): string {
  return html.replace(/<script(?![^>]*data-mm-toggle)([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs: string, body: string) => {
    if (!body.includes(NEEDLE)) return full
    const cut = cutToggleIife(body)
    if (cut !== null) return meaningful(cut) ? `<script${attrs}>${cut}</script>` : ''
    const defused = neutralize(body)
    return defused !== null ? `<script${attrs}>${defused}</script>` : ''
  })
}
