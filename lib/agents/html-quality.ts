/**
 * HTML Quality Checker — server-side feedback loop.
 *
 * Equivalent of: TypeScript compiler + browser DevTools + Lighthouse + link checker.
 * Runs after every agent tool result, before returning to the client.
 *
 * Two levels:
 *   critical → must be fixed (triggers one correction API call)
 *   warning  → reported to client but not blocking
 */

export type QualityReport = {
  score: number         // 0-100
  critical: string[]   // blocking issues — trigger correction
  warnings: string[]   // informational only
  htmlChecked: boolean // false if we couldn't reconstruct final HTML
}

type Page = { slug: string; name: string; html: string }
type Operation = { op: 'insert_after' | 'insert_before' | 'replace'; target: string; html: string }
type Edit = { find: string; replace: string }

// ── Server-side HTML apply (simplified version of client applyEdit + applySectionOp) ──

/** Apply a find/replace edit — exact match then whitespace-normalized. */
export function applyEditSS(html: string, find: string, replace: string): string {
  if (html.includes(find)) return html.replace(find, replace)
  // Whitespace-normalized fallback
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const nHtml = norm(html), nFind = norm(find)
  if (nHtml.includes(nFind)) {
    const idx = nHtml.indexOf(nFind)
    // Approximate index mapping
    let oi = 0, ni = 0
    while (ni < idx && oi < html.length) {
      if (/\s/.test(html[oi]) && (oi === 0 || /\s/.test(html[oi - 1]))) { oi++; continue }
      oi++; ni++
    }
    let oe = oi, ne = ni
    while (ne < ni + nFind.length && oe < html.length) {
      if (/\s/.test(html[oe]) && (oe === 0 || /\s/.test(html[oe - 1]))) { oe++; continue }
      oe++; ne++
    }
    return html.slice(0, oi) + replace + html.slice(oe)
  }
  return html // unapplied — return unchanged
}

/** Apply a section operation (insert_after/before/replace) by CSS selector. */
export function applyOpSS(html: string, op: Operation['op'], target: string, newHtml: string): string {
  const sm = target.trim().match(/^([a-z][a-z0-9]*)?(?:#([^.#\s]+))?(?:\.([^\s#]+))?$/i)
  if (!sm) return html
  const tagM = sm[1] || '', idM = sm[2] || '', classM = sm[3] ? sm[3].split('.')[0] : ''

  const tagPat = tagM || '[a-z][a-z0-9]*'
  const parts: string[] = [`<(${tagPat})`]
  if (idM)    parts.push(`(?=[^>]*id=["']${idM}["'])`)
  if (classM) parts.push(`(?=[^>]*class=["'][^"']*${classM}[^"']*["'])`)
  parts.push('[^>]*>')
  const openRe = new RegExp(parts.join(''), 'i')
  const openMatch = html.match(openRe)
  if (!openMatch || openMatch.index == null) return html

  const actualTag = (openMatch[1] || tagM).toLowerCase()
  if (!actualTag) return html

  const start = openMatch.index
  const scan = html.slice(start)
  let d = 0, pos = 0, end = -1
  while (pos < scan.length) {
    const no = scan.indexOf(`<${actualTag}`, pos)
    const nc = scan.indexOf(`</${actualTag}>`, pos)
    if (nc === -1) break
    if (no !== -1 && no < nc) { d++; pos = no + 1 }
    else { d--; pos = nc + `</${actualTag}>`.length; if (d === 0) { end = start + pos; break } }
  }
  if (end === -1) return html

  if (op === 'replace') return html.slice(0, start) + newHtml + html.slice(end)
  if (op === 'insert_before') return html.slice(0, start) + newHtml + '\n' + html.slice(start)
  return html.slice(0, end) + '\n' + newHtml + html.slice(end) // insert_after
}

/** Reconstruct final HTML from an edit_page result by applying ops and edits. */
export function reconstructEditedHtml(
  currentHtml: string,
  operations: Operation[],
  edits: Edit[]
): string {
  let html = currentHtml
  for (const op of operations) html = applyOpSS(html, op.op, op.target, op.html)
  for (const edit of edits) html = applyEditSS(html, edit.find, edit.replace)
  return html
}

// ── Quality checks ────────────────────────────────────────────────────────────

export function checkHtmlQuality(html: string, pages: Page[] = []): QualityReport {
  const critical: string[] = []
  const warnings: string[] = []

  // ── HTML structure ───────────────────────────────────────────────
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length
  if (h1Count > 1) critical.push(`${h1Count} tag <h1> trovati — deve essere esattamente 1`)
  if (h1Count === 0) critical.push('Nessun <h1> — obbligatorio per SEO')

  // Heading hierarchy jump (h1→h3 without h2)
  if (/<h3[\s>]/i.test(html) && !/<h2[\s>]/i.test(html))
    warnings.push('H3 senza H2 — gerarchia heading errata (H1→H2→H3)')

  // Block element inside <p>
  if (/<p[^>]*>[\s\S]*?<(div|section|ul|ol|h[1-6]|blockquote)/i.test(html))
    critical.push('Elemento block (<div>/<section>/<ul>/ecc.) dentro <p> — HTML invalido')

  // ── CSS quality ──────────────────────────────────────────────────
  const inlineStyleCount = (html.match(/\bstyle="/gi) ?? []).length
  if (inlineStyleCount > 8) warnings.push(`${inlineStyleCount} attributi style="" inline — preferire classi CSS`)

  if (/\b(?:text-4xl|text-xl|font-bold|font-semibold|leading-tight|tracking-wide|md:|lg:|xl:)\b/.test(html))
    critical.push('Classi Tailwind rilevate — questo sito usa CSS custom, non Tailwind')

  if (/--tw-[a-z-]+/i.test(html))
    warnings.push('CSS vars Tailwind (--tw-...) rilevate — rimuovere')

  // ── Links ────────────────────────────────────────────────────────
  const absInternalLinks = html.match(/href="\/[^"#?]/g) ?? []
  if (absInternalLinks.length)
    critical.push(`${absInternalLinks.length} link assoluti (href="/...") — usare href="./slug"`)

  if (pages.length > 0) {
    const knownSlugs = new Set(pages.map(p => p.slug))
    const relLinks = [...html.matchAll(/href="\.\/([\w-]+)"/g)]
    const broken = relLinks.filter(([, slug]) =>
      slug !== '' && !knownSlugs.has(slug) && slug !== 'blog' && slug !== 'blog/'
    )
    if (broken.length)
      warnings.push(`Link rotti: ${broken.map(([,s]) => `./#{s}`).join(', ')} — pagine inesistenti`)
  }

  // ── Images ───────────────────────────────────────────────────────
  const imgTags = html.match(/<img[^>]*>/gi) ?? []
  const imgNoAlt = imgTags.filter(img => !/\balt=/.test(img)).length
  if (imgNoAlt > 0) warnings.push(`${imgNoAlt} <img> senza alt="" — richiesto per accessibilità e SEO`)

  const imgNoDim = imgTags.filter(img => !/\bwidth=/.test(img) || !/\bheight=/.test(img)).length
  if (imgNoDim > 2) warnings.push(`${imgNoDim} <img> senza width/height espliciti — causa layout shift (CLS)`)

  // ── Performance ──────────────────────────────────────────────────
  if (/fonts\.googleapis\.com[^"']*(?<!display=swap)["']/i.test(html))
    warnings.push('Google Fonts senza display=swap — aggiungere ?display=swap per evitare FOIT')

  if (/<script\b(?![^>]*\bdefer\b)(?![^>]*\basync\b)[^>]+src=/i.test(html))
    warnings.push('Script esterno senza defer/async — blocca il rendering della pagina')

  // ── Project-specific rules ───────────────────────────────────────
  if (/<form/i.test(html) && !/api\/forms/i.test(html) && !/action="[^"]*api/i.test(html))
    critical.push('Form senza fetch("/api/forms") — le form devono usare l\'endpoint interno')

  if (/class=["'][^"']*\bactive\b[^"']*["']/.test(html) &&
      /mobile.menu|menu.mobile|hamburger|nav.toggle/i.test(html))
    warnings.push('Classe "active" su menu mobile — questo progetto usa "open" per il toggle')

  // ── Score ────────────────────────────────────────────────────────
  const score = critical.length > 0 ? 40 :
                warnings.length > 3  ? 60 :
                warnings.length > 0  ? 80 : 100

  return { score, critical, warnings, htmlChecked: true }
}

/** Format quality report as a concise message for the agent correction prompt. */
export function formatReportForAgent(report: QualityReport, pageSlug: string): string {
  const lines = [
    `⚠️ QUALITY CHECK fallito su pagina "${pageSlug}" (score: ${report.score}/100).`,
    'Correggi questi problemi PRIMA di restituire il risultato:',
    ...report.critical.map(i => `  ❌ ${i}`),
  ]
  if (report.warnings.length)
    lines.push('Avvertenze (correggi se possibile):', ...report.warnings.map(w => `  ⚡ ${w}`))
  lines.push('Usa edit_page o create_site per correggere e risottometti.')
  return lines.join('\n')
}
