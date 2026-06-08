/**
 * SEO Compiler — deterministic validation pipeline.
 *
 * Runs on every save/publish and BLOCKS publication on critical failures.
 * The LLM produces content; this compiler enforces correctness.
 *
 * Two severity levels:
 *   CRITICAL — blocks publish, must be fixed (or explicitly overridden)
 *   WARNING  — shown to user, does not block
 *
 * Usage:
 *   const report = compileSeo(pages, siteConfig)
 *   if (report.blockingIssues.length > 0) { /* show errors, refuse publish *\/ }
 */

export type SeoIssue = {
  page: string         // slug ('*' = site-wide)
  code: string         // machine-readable code
  message: string      // human-readable message (Italian)
  severity: 'critical' | 'warning'
  fix?: string         // suggested fix hint
}

export type SeoReport = {
  blockingIssues: SeoIssue[]   // critical — block publish
  warnings: SeoIssue[]          // advisory — show but allow
  score: number                  // 0–100
  passedChecks: number
  totalChecks: number
}

type Page = { slug: string; name: string; html: string; robots?: { noindex?: boolean; nofollow?: boolean } }
type SiteConfig = {
  customDomain?: string
  context?: { businessName?: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const txt = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))
  return m?.[1]?.trim() ?? ''
}

// ── Per-page checks ───────────────────────────────────────────────────────────

function checkPage(page: Page): SeoIssue[] {
  const issues: SeoIssue[] = []
  const h = page.html
  const slug = page.slug
  const noindex = page.robots?.noindex

  // Skip SEO checks on noindex pages (they're intentionally hidden from Google)
  if (noindex) return []

  const add = (severity: SeoIssue['severity'], code: string, message: string, fix?: string) =>
    issues.push({ page: slug, code, message, severity, fix })

  // ── Title ──────────────────────────────────────────────────────────
  const titleMatch = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch?.[1]?.trim() ?? ''
  if (!title)
    add('critical', 'MISSING_TITLE', 'Tag <title> mancante', 'Aggiungi <title>Nome sito | Pagina</title> nel <head>')
  else if (title.length > 60)
    add('warning', 'TITLE_TOO_LONG', `<title> di ${title.length} caratteri (max 60): "${title.slice(0, 50)}…"`, 'Accorcia il titolo')
  else if (title.length < 10)
    add('warning', 'TITLE_TOO_SHORT', `<title> troppo corto (${title.length} car.): "${title}"`, 'Espandi il titolo')

  // ── Meta description ───────────────────────────────────────────────
  const descMatch = h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    ?? h.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
  const desc = descMatch?.[1]?.trim() ?? ''
  if (!desc)
    add('critical', 'MISSING_DESCRIPTION', 'Meta description mancante', 'Aggiungi <meta name="description" content="…"> (120–160 caratteri)')
  else if (desc.length > 160)
    add('warning', 'DESC_TOO_LONG', `Meta description di ${desc.length} caratteri (max 160)`, 'Accorcia la description')
  else if (desc.length < 50)
    add('warning', 'DESC_TOO_SHORT', `Meta description troppo corta (${desc.length} car.)`, 'Espandi la description a 120–160 caratteri')

  // ── H1 ─────────────────────────────────────────────────────────────
  const h1s = h.match(/<h1[\s>]/gi) ?? []
  if (h1s.length === 0)
    add('critical', 'MISSING_H1', 'Nessun tag <h1> — obbligatorio per SEO', 'Aggiungi un <h1> con la keyword principale')
  else if (h1s.length > 1)
    add('critical', 'MULTIPLE_H1', `${h1s.length} tag <h1> trovati — deve essercene esattamente 1`, 'Mantieni solo 1 <h1>, usa <h2> per gli altri')

  // ── Heading hierarchy ──────────────────────────────────────────────
  if (/<h3[\s>]/i.test(h) && !/<h2[\s>]/i.test(h))
    add('warning', 'HEADING_SKIP', 'Gerarchia heading non valida (H1→H3 senza H2)', 'Inserisci almeno un <h2> prima degli <h3>')

  // ── Images ─────────────────────────────────────────────────────────
  const imgs = h.match(/<img[^>]*>/gi) ?? []
  const missingAlt = imgs.filter(img => !/\balt=/.test(img))
  if (missingAlt.length > 0)
    add('warning', 'IMG_NO_ALT', `${missingAlt.length} immagini senza attributo alt=""`, 'Aggiungi alt descrittivo su ogni <img>')

  const missingDim = imgs.filter(img => !/\bwidth=/.test(img) || !/\bheight=/.test(img))
  if (missingDim.length > 3)
    add('warning', 'IMG_NO_DIM', `${missingDim.length} immagini senza width/height — causa layout shift (CLS)`, 'Aggiungi width e height su ogni <img>')

  // ── Canonical ──────────────────────────────────────────────────────
  // Canonical is injected at serve time — no check needed here.

  // ── Schema.org ─────────────────────────────────────────────────────
  if (slug === 'home' && !/"@type"\s*:\s*"(Organization|WebSite|LocalBusiness)"/i.test(h))
    add('warning', 'NO_SCHEMA_HOME', 'Nessun schema.org Organization/WebSite sulla home page', 'Aggiungi JSON-LD con @type:WebSite o Organization')

  // ── Content depth ──────────────────────────────────────────────────
  const wordCount = txt(h).split(/\s+/).filter(Boolean).length
  if (wordCount < 100 && slug !== 'home')
    add('warning', 'LOW_CONTENT', `Pagina con pochi contenuti (${wordCount} parole) — rischio thin content`, 'Aggiungi almeno 200–300 parole di contenuto utile')

  // ── Performance signals ────────────────────────────────────────────
  if (/fonts\.googleapis\.com[^"']*["'](?!.*display=swap)/i.test(h))
    add('warning', 'FONT_NO_SWAP', 'Google Fonts senza display=swap — rischio testo invisibile (FOIT)', 'Aggiungi &display=swap all\'URL del font')

  if (/<script\b(?![^>]*\bdefer\b)(?![^>]*\basync\b)[^>]+src=/i.test(h))
    add('warning', 'RENDER_BLOCKING_SCRIPT', 'Script esterno senza defer/async — blocca il rendering', 'Aggiungi defer o async al tag <script src="…">')

  // ── Links ──────────────────────────────────────────────────────────
  const absLinks = h.match(/href="\/[^"#?]/g) ?? []
  if (absLinks.length > 0)
    add('warning', 'ABS_LINKS', `${absLinks.length} link assoluti (href="/…") — usare href="./slug"`, 'Sostituisci href="/..." con href="./..."')

  return issues
}

// ── Site-wide checks ──────────────────────────────────────────────────────────

function checkSite(pages: Page[], _config: SiteConfig): SeoIssue[] {
  const issues: SeoIssue[] = []
  const add = (severity: SeoIssue['severity'], code: string, message: string, fix?: string) =>
    issues.push({ page: '*', code, message, severity, fix })

  const indexablePages = pages.filter(p => !p.robots?.noindex)

  // ── Duplicate titles ───────────────────────────────────────────────
  const titleMap = new Map<string, string[]>()
  for (const p of indexablePages) {
    const t = (p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim().toLowerCase()
    if (t) {
      const existing = titleMap.get(t) ?? []
      titleMap.set(t, [...existing, p.slug])
    }
  }
  for (const [title, slugs] of titleMap) {
    if (slugs.length > 1)
      add('warning', 'DUPLICATE_TITLE', `Title duplicato su ${slugs.length} pagine: "${title.slice(0, 50)}" (${slugs.join(', ')})`, 'Rendi ogni <title> unico')
  }

  // ── Duplicate descriptions ─────────────────────────────────────────
  const descMap = new Map<string, string[]>()
  for (const p of indexablePages) {
    const d = (
      p.html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? ''
    ).trim().toLowerCase()
    if (d) {
      const existing = descMap.get(d) ?? []
      descMap.set(d, [...existing, p.slug])
    }
  }
  for (const [, slugs] of descMap) {
    if (slugs.length > 1)
      add('warning', 'DUPLICATE_DESC', `Meta description duplicata su ${slugs.length} pagine (${slugs.join(', ')})`, 'Rendi ogni meta description unica')
  }

  // ── No indexable pages at all ──────────────────────────────────────
  if (indexablePages.length === 0)
    add('critical', 'ALL_NOINDEX', 'Nessuna pagina indicizzabile — tutte hanno noindex', 'Rimuovi noindex almeno dalla home page')

  return issues
}

// ── Main compiler ─────────────────────────────────────────────────────────────

export function compileSeo(pages: Page[], config: SiteConfig = {}): SeoReport {
  const allIssues: SeoIssue[] = []

  for (const page of pages) {
    allIssues.push(...checkPage(page))
  }
  allIssues.push(...checkSite(pages, config))

  const blockingIssues = allIssues.filter(i => i.severity === 'critical')
  const warnings = allIssues.filter(i => i.severity === 'warning')

  // Score: start at 100, -10 per critical, -3 per warning, floor 0
  const score = Math.max(0, 100 - blockingIssues.length * 10 - warnings.length * 3)

  // Approximate total checks (per-page × pages + site-wide)
  const CHECKS_PER_PAGE = 10
  const SITE_CHECKS = 3
  const totalChecks = pages.length * CHECKS_PER_PAGE + SITE_CHECKS
  const passedChecks = totalChecks - allIssues.length

  return { blockingIssues, warnings, score, passedChecks, totalChecks }
}

/** Format a SeoReport as a compact string for logging/agent feedback. */
export function formatSeoReport(report: SeoReport): string {
  if (report.blockingIssues.length === 0 && report.warnings.length === 0)
    return `✅ SEO OK — score ${report.score}/100 (${report.passedChecks}/${report.totalChecks} check superati)`

  const lines: string[] = [`SEO score: ${report.score}/100`]
  if (report.blockingIssues.length > 0) {
    lines.push(`\n❌ PROBLEMI CRITICI (${report.blockingIssues.length}) — bloccano la pubblicazione:`)
    for (const i of report.blockingIssues)
      lines.push(`  [${i.page}] ${i.message}${i.fix ? ` → ${i.fix}` : ''}`)
  }
  if (report.warnings.length > 0) {
    lines.push(`\n⚠️  Avvertenze (${report.warnings.length}):`)
    for (const w of report.warnings)
      lines.push(`  [${w.page}] ${w.message}`)
  }
  return lines.join('\n')
}
