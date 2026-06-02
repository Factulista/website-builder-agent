import { callClaude } from './config'
import { fetchWithRetry } from './fetch-retry'
import { extractImageUrls } from './site-analyzer'
import type { LogoDefinition } from './design-agent'
import { langName } from './detect-lang'
import { buildContextPrompt, type ProjectContext } from './memory-agent'

/** Fetches an image URL and returns it as base64 for multimodal API calls. */
async function fetchImageAsBase64(url: string): Promise<{ data: string; media_type: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const ct = res.headers.get('content-type') || 'image/jpeg'
    const media_type = ct.split(';')[0].trim()
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowed.includes(media_type)) return null
    if (base64.length > 4_000_000) return null
    return { data: base64, media_type }
  } catch { return null }
}

type Page = { slug: string; name: string; html: string }

/**
 * Extracts the logo HTML element from the navbar of an existing page.
 * Looks for common logo class patterns: .nav-logo, .logo, .brand, .site-logo
 * Returns the full element HTML (e.g. <a class="nav-logo">…</a>) or null.
 */
function extractNavLogo(html: string): string | null {
  // Match anchor or div/span with logo-related class inside a <nav>
  const patterns = [
    /<a\b[^>]*class="[^"]*(?:nav-logo|site-logo|brand-logo)[^"]*"[^>]*>[\s\S]*?<\/a>/i,
    /<div\b[^>]*class="[^"]*(?:nav-logo|site-logo|brand-logo)[^"]*"[^>]*>[\s\S]*?<\/div>/i,
    /<a\b[^>]*class="[^"]*\blog[^"o][^"]*"[^>]*>[\s\S]*?<\/a>/i,  // class contains "log" (logo, logotype)
    /<span\b[^>]*class="[^"]*(?:logo|brand)[^"]*"[^>]*>[\s\S]*?<\/span>/i,
  ]
  for (const pattern of patterns) {
    const m = html.match(pattern)
    if (m) return m[0].replace(/\s+/g, ' ').trim()
  }
  return null
}

/**
 * Renders a LogoDefinition into an HTML string suitable for use in a navbar.
 * Used when the html agent builds new pages that need to match the stored logo.
 */
function renderLogoHtml(logo: LogoDefinition, href = './'): string {
  if (logo.type === 'img') {
    return `<a href="${href}" class="nav-logo" style="display:flex;align-items:center;text-decoration:none;">` +
      `<img src="${logo.content}" alt="logo" style="height:36px;width:auto;object-fit:contain;">` +
      `</a>`
  }
  if (logo.type === 'svg') {
    // Wrap the SVG in a link; replace any fill="currentColor" with the logo color
    const svgColored = logo.content.replace(/fill="currentColor"/gi, `fill="${logo.color}"`)
    return `<a href="${href}" class="nav-logo" style="display:flex;align-items:center;text-decoration:none;">${svgColored}</a>`
  }
  // type === 'text'
  const name = logo.content
  const accent = logo.accentChar
  const displayName = accent && name.includes(accent)
    ? name.replace(accent, `<span style="color:var(--color-accent,${logo.color})">${accent}</span>`)
    : name
  return `<a href="${href}" class="nav-logo" style="font-size:1.4rem;font-weight:800;color:${logo.color};text-decoration:none;letter-spacing:-0.5px;">${displayName}</a>`
}

/**
 * Builds a compact Section Index for the LLM: a short list of structural
 * landmarks (header, nav, main, footer, section, article, plus divs with id/class)
 * with their CSS-like selectors. ~150 tokens for a typical page.
 *
 * Format example:
 *   header.site-header
 *   nav#main-nav
 *   section#hero.hero-section
 *   section#features
 *   section#pricing.pricing-section
 *   footer.site-footer
 *
 * The agent uses these selectors in the "operations" field of edit_page
 * (insert_after / insert_before / replace) instead of fragile find strings.
 */
function buildSectionIndex(html: string): string {
  const lines: string[] = []
  const re = /<(header|nav|main|footer|section|article|div)(\s[^>]*)?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase()
    const attrs = m[2] ?? ''
    const idM   = attrs.match(/id=["']([^"']+)["']/)
    const clsM  = attrs.match(/class=["']([^"']+)["']/)
    // Skip bare <div> without any id/class — too generic
    if (tag === 'div' && !idM && !clsM) continue
    let selector = tag
    if (idM)  selector += `#${idM[1]}`
    if (clsM) selector += `.${clsM[1].split(' ')[0]}`  // first class only
    lines.push(`  ${selector}`)
  }
  // Deduplicate preserving order
  const seen = new Set<string>()
  return lines.filter(l => { if (seen.has(l)) return false; seen.add(l); return true }).join('\n')
}

/**
 * Maps user message keywords to a section selector from the section index.
 * Returns the best matching selector (e.g. "section#pricing") or null.
 */
function identifyTargetSection(userMsg: string, sectionIndex: string): string | null {
  const msg = userMsg.toLowerCase()
  const selectors = sectionIndex.split('\n').map(l => l.trim()).filter(Boolean)

  // Keyword → section label hints (order matters: more specific first)
  const hints: [RegExp, string[]][] = [
    [/\b(pricing|precios?|prezzi|plan|piani|tariff)/i,          ['pricing', 'precios', 'prezzi', 'plan']],
    [/\b(hero|headline|banner|above.the.fold|portada)/i,        ['hero', 'banner', 'portada']],
    [/\b(features?|funcionalidades?|caratteristiche|funzion)/i, ['features', 'funcionalidades', 'caratteristiche']],
    [/\b(contact|contatto|contacto|formulario|form)/i,          ['contact', 'contatto', 'contacto']],
    [/\b(footer|pie de página|piè di pagina)/i,                 ['footer']],
    [/\b(header|nav|menú|menu|navbar|navigation)/i,             ['header', 'nav', 'navbar']],
    [/\b(testimonial|recensioni|review|cliente)/i,              ['testimonial', 'review', 'client']],
    [/\b(faq|domande|preguntas|accordion)/i,                    ['faq']],
    [/\b(cta|call.to.action|call to action)/i,                  ['cta']],
    [/\b(blog|articoli|articulos|post)/i,                       ['blog']],
  ]

  for (const [pattern, keywords] of hints) {
    if (!pattern.test(msg)) continue
    // Find a selector in the index that contains one of the keywords
    const match = selectors.find(sel =>
      keywords.some(kw => sel.toLowerCase().includes(kw))
    )
    if (match) return match
  }
  return null
}

/**
 * Extracts the full HTML of a single section identified by a CSS-like selector.
 * Uses the same depth-aware tag matching as applySectionOp.
 * Returns null if the selector doesn't match anything.
 */
function extractSectionHtml(html: string, selector: string): string | null {
  const selectorRe = /^([a-z][a-z0-9]*)?(?:#([^.#\s]+))?(?:\.([^\s#]+))?$/i
  const sm = selector.trim().match(selectorRe)
  if (!sm) return null
  const tagM   = sm[1] || ''
  const idM    = sm[2] || ''
  const classM = sm[3] ? sm[3].split('.')[0] : ''

  const tagPat = tagM || '[a-z][a-z0-9]*'
  const parts: string[] = [`<(${tagPat})`]
  if (idM)    parts.push(`(?=[^>]*id=["']${idM}["'])`)
  if (classM) parts.push(`(?=[^>]*class=["'][^"']*${classM}[^"']*["'])`)
  parts.push('[^>]*>')
  const openRe = new RegExp(parts.join(''), 'i')

  const openMatch = html.match(openRe)
  if (!openMatch || openMatch.index === undefined) return null

  const actualTag = openMatch[1]?.toLowerCase() || tagM.toLowerCase()
  if (!actualTag) return null

  const start   = openMatch.index
  const scan    = html.slice(start)
  const openStr  = `<${actualTag}`
  const closeStr = `</${actualTag}>`
  let d = 0, pos = 0, end = -1
  while (pos < scan.length) {
    const nextOpen  = scan.indexOf(openStr,  pos)
    const nextClose = scan.indexOf(closeStr, pos)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) { d++; pos = nextOpen + 1 }
    else { d--; pos = nextClose + closeStr.length; if (d === 0) { end = start + pos; break } }
  }
  return end === -1 ? null : html.slice(start, end)
}

/**
 * Builds a compact HTML skeleton for the LLM context:
 * - Optionally keeps or omits <style> blocks
 * - Removes HTML comments
 * - Collapses whitespace
 * - Truncates long text nodes to 80 chars so the agent can still identify elements
 *   but the payload is 70-80% smaller than the full HTML.
 *
 * The find/replace strings produced by the agent are then applied against the
 * ORIGINAL full HTML — not the skeleton — so edits always work on the real content.
 */
function buildHtmlSkeleton(html: string, includeStyles = false): string {
  return html
    // Keep or remove <style> blocks depending on the request type
    .replace(/<style[\s\S]*?<\/style>/gi,
      includeStyles
        ? (m: string) => m  // keep the full style block
        : () => '<style>/* CSS omitted — se l\'agente ha bisogno dei colori, sono nel blocco PALETTE */</style>'
    )
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Truncate long text nodes (keep first 80 chars + ellipsis)
    .replace(/>([^<]{80,})</g, (_, text) => `>${text.slice(0, 80).trimEnd()}…<`)
    .trim()
}

/**
 * Strips shared frame elements (nav, footer, mobile menu) from HTML before
 * sending to the agent. The agent never needs to read these for content edits —
 * nav/footer are managed by the sync system. This saves 8-15K tokens per run.
 *
 * Only called when the operation is NOT a nav/menu/footer edit.
 */
function stripSharedFrame(html: string): string {
  return html
    // Remove <nav> blocks
    .replace(/<nav[\s\S]*?<\/nav>/gi, '<!-- nav omitted — managed by shared frame -->')
    // Remove <footer> blocks
    .replace(/<footer[\s\S]*?<\/footer>/gi, '<!-- footer omitted — managed by shared frame -->')
    // Remove mobile menu divs (class="mobile-menu ..." or id="mobileMenu")
    .replace(/<div[^>]*(?:class="[^"]*mobile-menu[^"]*"|id="mobileMenu")[^>]*>[\s\S]*?<\/div>/gi, '<!-- mobile menu omitted -->')
}

/**
 * Returns true when the user's request is about colors, backgrounds or visual styles.
 * Used to decide whether to include the full CSS in the agent context.
 */
function isColorOrStyleRequest(msg: string): boolean {
  const m = msg.toLowerCase()
  return /sfondo|background|colore|color|grigio|gray|grey|bianco|white|nero|black|rosso|red|blu|blue|verde|green|rgba?|#[0-9a-f]{3,6}|palette|stesso stile|stesso colore|uguale.*sfond|sfond.*uguale|cambia.*color|color.*cambia|traspar|opaci|gradien/i.test(m)
}

/**
 * Extracts the color palette from a page's CSS:
 * - :root CSS custom properties (--color-*)
 * - background-color / background: #... / background: rgb rules
 * - color: rules
 * Returns a compact summary string.
 */
function extractColorPalette(html: string): string {
  const styleMatch = html.match(/<style[\s\S]*?<\/style>/gi)
  if (!styleMatch) return ''
  const css = styleMatch.join('\n')

  const lines: string[] = []

  // CSS custom properties (:root)
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/i)
  if (rootMatch) {
    const props = rootMatch[1]
      .split(';')
      .map(l => l.trim())
      .filter(l => l && /--/.test(l))
    if (props.length) lines.push('CSS variables:\n  ' + props.join('\n  '))
  }

  // background-color / background: <value> rules (exclude background-image)
  const bgRules = [...css.matchAll(/([.#\w][^{]*)\{[^}]*background(?:-color)?:\s*([^;}\n]+)/gi)]
  const bgSeen = new Set<string>()
  for (const m of bgRules) {
    const selector = m[1].trim().replace(/\s+/g, ' ').slice(0, 60)
    const value = m[2].trim().replace(/\s+/g, ' ')
    if (/url\(/.test(value)) continue // skip background-image
    const key = `${selector} → ${value}`
    if (!bgSeen.has(key)) { bgSeen.add(key); lines.push(`bg  ${key}`) }
    if (bgSeen.size > 30) break
  }

  // Inline style background colors on elements
  const inlineBg = [...html.matchAll(/style="[^"]*background(?:-color)?:\s*([^;}"]+)/gi)]
  const inlineSeen = new Set<string>()
  for (const m of inlineBg) {
    const v = m[1].trim()
    if (/url\(/.test(v)) continue
    if (!inlineSeen.has(v)) { inlineSeen.add(v); lines.push(`inline bg: ${v}`) }
    if (inlineSeen.size > 10) break
  }

  return lines.length ? lines.join('\n') : '(nessuna palette rilevata)'
}

const HTML_TOOLS = [
  {
    name: 'create_site',
    description: 'Crea un sito multi-pagina da zero. Usalo SOLO per il primo sito o quando l\'utente chiede di rifare tutto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              name: { type: 'string' },
              html: { type: 'string' },
            },
            required: ['slug', 'name', 'html'],
          },
        },
        summary: { type: 'string' },
      },
      required: ['pages', 'summary'],
    },
  },
  {
    name: 'edit_page',
    description: 'Modifica UNA pagina specifica del sito. USA "operations" per inserire o sostituire intere sezioni (più affidabile, immune al troncamento). USA "edits" solo per modifiche chirurgiche: attributi CSS, src immagine, testi brevi univoci.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        operations: {
          type: 'array',
          description: 'Operazioni selector-based per inserire/sostituire interi blocchi. PREFERISCI queste a "edits" quando devi aggiungere o rimpiazzare sezioni intere.',
          items: {
            type: 'object',
            properties: {
              op:     { type: 'string', enum: ['insert_after', 'insert_before', 'replace'], description: 'insert_after: inserisce newHtml dopo la sezione target. insert_before: inserisce prima. replace: sostituisce l\'intera sezione.' },
              target: { type: 'string', description: 'Selettore CSS dell\'elemento target dal SECTION INDEX (es: "section#pricing", "footer.site-footer", "header"). Sintassi: tag, tag#id, tag.class, tag#id.class.' },
              html:   { type: 'string', description: 'HTML completo da inserire o con cui sostituire la sezione.' },
            },
            required: ['op', 'target', 'html'],
          },
        },
        edits: {
          type: 'array',
          description: 'Find/replace chirurgici. Usa SOLO per: cambi CSS, src immagine, testi brevi univoci, singoli attributi. NON per inserire o sostituire blocchi interi (usa operations).',
          items: {
            type: 'object',
            properties: {
              find:    { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        typed_edits: {
          type: 'array',
          description: 'Operazioni semantiche che NON richiedono generare HTML. Usa SEMPRE questi al posto di edits/operations quando possibile — zero rischio di rompere struttura. Tipi: css_var (cambia CSS variable in :root), css_prop (cambia proprietà CSS in un selettore), attr (cambia attributo HTML come href/src/alt), text (cambia testo visibile di un elemento).',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['css_var', 'css_prop', 'attr', 'text'], description: 'css_var: cambia --variabile in :root. css_prop: cambia property CSS in selettore. attr: cambia attributo HTML. text: cambia testo visibile.' },
              selector: { type: 'string', description: 'Selettore CSS (richiesto per css_prop, attr, text). Es: ".hero-button", "#cta", "nav .logo"' },
              var: { type: 'string', description: 'Nome CSS variable SENZA -- (solo per css_var). Es: "color-accent", "font-body"' },
              prop: { type: 'string', description: 'Proprietà CSS (solo per css_prop). Es: "font-size", "padding", "border-radius"' },
              attr: { type: 'string', description: 'Nome attributo HTML (solo per attr). Es: "href", "src", "alt", "placeholder"' },
              value: { type: 'string', description: 'Nuovo valore da impostare' },
            },
            required: ['type', 'value'],
          },
        },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'OBBLIGATORIO per operazioni con operations[]. Lista dei selettori CSS delle sezioni che verranno modificate (es: ["section#hero", "section#pricing"]). Aiuta a verificare che non vengano toccate sezioni non richieste.',
        },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'summary'],
    },
  },
  {
    name: 'add_page',
    description: 'Aggiunge una NUOVA pagina al sito esistente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        html: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['slug', 'name', 'html', 'summary'],
    },
  },
  {
    name: 'delete_page',
    description: 'Elimina una pagina dal sito. Non può eliminare "home".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['pageSlug', 'summary'],
    },
  },
  {
    name: 'update_blog_header',
    description: 'Aggiorna la sezione HTML statica personalizzata che appare sopra la griglia degli articoli nel blog. Usalo quando l\'utente vuole modificare l\'intestazione, hero, titolo o testo introduttivo della pagina blog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: { type: 'string', description: 'HTML della sezione statica da mostrare sopra la griglia articoli. Deve essere HTML completo e stilato inline.' },
        summary: { type: 'string' },
      },
      required: ['html', 'summary'],
    },
  },
  {
    name: 'set_inject_point',
    description: 'Imposta HTML personalizzato in un punto di iniezione del sito (script, iframe, widget, form newsletter, analytics, cookie banner, ecc.). Usalo quando l\'utente vuole aggiungere un embed o codice esterno senza toccare le pagine HTML. Passare html="" rimuove il contenuto dal punto.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slot: {
          type: 'string',
          enum: ['head', 'body_end', 'blog_post_bottom', 'blog_list_bottom'],
          description: 'head = dentro <head> di ogni pagina (per script, meta, link CSS). body_end = prima di </body> (per pixel, chat widget, tag manager). blog_post_bottom = dopo ogni articolo del blog (newsletter, CTA, embed). blog_list_bottom = dopo la griglia articoli nel blog.',
        },
        html: {
          type: 'string',
          description: 'HTML da iniettare. Può essere <iframe>, <script>, <div> o qualsiasi HTML valido. Passare stringa vuota per rimuovere il punto.',
        },
        summary: { type: 'string' },
      },
      required: ['slot', 'html', 'summary'],
    },
  },
  {
    name: 'insert_component',
    description: 'Inserisce un componente parametrico pre-costruito in UNA O PIÙ pagine in un colpo solo. PREFERISCI QUESTO TOOL rispetto a generare HTML da zero quando il pattern richiesto è uno di quelli supportati — risparmi token e garantisci consistenza visiva. Per modifiche nav (es. mega-menu), passa SEMPRE tutti gli slug delle pagine che hanno la stessa nav. Vedi sezione "COMPONENTI PARAMETRICI" nel system prompt per la lista completa.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista degli slug delle pagine target. Per modifiche di NAV o FOOTER, passa SEMPRE tutti gli slug del sito così la modifica appare ovunque.',
        },
        componentId: { type: 'string', description: 'ID del componente da renderizzare (es. "nav-feature-dropdown", "feature-grid").' },
        data: {
          type: 'object',
          description: 'Dati per il rendering del componente. La forma esatta dipende dal componentId — vedi paramSchema nel system prompt.',
        },
        placement: {
          type: 'string',
          enum: ['replace-nav-link', 'before-footer', 'end-of-body', 'replace-selector'],
          description: 'Dove inserire il componente:\n- replace-nav-link: sostituisce un <a> della nav identificato per testo (richiede targetText)\n- before-footer: appena prima del <footer>\n- end-of-body: prima di </body>\n- replace-selector: sostituisce il primo elemento che matcha (richiede selector — es. "#features-grid")',
        },
        targetText: { type: 'string', description: 'Solo per placement=replace-nav-link: testo del link nav da sostituire (es. "Funcionalidades").' },
        selector: { type: 'string', description: 'Solo per placement=replace-selector: selettore CSS dell\'elemento da sostituire.' },
        summary: { type: 'string' },
      },
      required: ['pageSlugs', 'componentId', 'data', 'placement', 'summary'],
    },
  },
]

export async function runHtmlAgentWithPlan(
  userRequest: string,
  plan: import('./planner').SitePlan,
  content: import('./content-agent').ContentOutput,
  design: import('./design-agent').DesignOutput,
  apiKey: string,
  existingPages: { slug: string; name: string }[] = []
) {
  const allPages = [
    ...existingPages,
    ...plan.pages.filter(p => !existingPages.some(ep => ep.slug === p.slug)),
  ]

  const system = `Sei un esperto sviluppatore HTML. Generi siti web HTML completi usando il contenuto e il design forniti.

REGOLE:
- Genera HTML completo (<!DOCTYPE html>...) per ogni pagina del piano.
- Usa ESCLUSIVAMENTE i testi forniti nel contenuto — non inventarne altri.
- Il CSS fornito contiene solo le variabili :root e il reset base. DEVI aggiungere tu tutto il CSS dei componenti (navbar, hero, button, card, footer, sezioni, media queries, ecc.) usando le CSS custom properties fornite.
- Includi Google Fonts: ${design.googleFontsUrl ?? 'nessuno'}
- Link tra pagine con href relativi senza .html (es: ./chi-siamo).
- Includi Schema.org JSON-LD nel <head> dove fornito.
- Mobile-first, semantico, accessibile.
- MAI generare una pagina con slug "blog". Se il piano include blog, aggiungi solo il link <a href="./blog">Blog</a> nella nav — il blog è un sistema dinamico separato.
${allPages.length > plan.pages.length ? `- TUTTE LE PAGINE DEL SITO (per i link navbar): ${allPages.map(p => `${p.name} → ./${p.slug === 'home' ? '' : p.slug}`).join(', ')}` : ''}
SEO URL — REGOLA CRITICA:
- canonical e og:url usano SEMPRE {{site_url}} come radice (MAI URL inventati come https://miodominio.com).
- Formato: <link rel="canonical" href="{{site_url}}/PAGE_SLUG"> — home → {{site_url}}/, altre pagine → {{site_url}}/SLUG.
- Schema.org JSON-LD: campo "url" e "@id" → {{site_url}} o {{site_url}}/SLUG.`

  const userMessage = `Richiesta: ${userRequest}

PIANO:
${plan.pages.map(p => `- ${p.slug}: sezioni ${p.sections.join(', ')}`).join('\n')}

CSS:
${design.css}

CONTENUTO PER PAGINA:
${content.pages.map(p => `
=== ${p.slug} ===
Title: ${p.title}
Meta: ${p.metaDescription}
H1: ${p.h1}
Sezioni: ${JSON.stringify(p.sections)}
Schema: ${p.schemaOrg ?? 'nessuno'}
`).join('\n')}`

  const tools = [
    {
      name: 'create_site',
      description: 'Genera tutte le pagine HTML del sito.',
      input_schema: {
        type: 'object' as const,
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                name: { type: 'string' },
                html: { type: 'string' },
              },
              required: ['slug', 'name', 'html'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['pages', 'summary'],
      },
    },
  ]

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      system,
      tools,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  }, 'html')

  if (!res.ok) throw new Error(`HTML Agent (pipeline) error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in HTML pipeline response')
  return toolUse.input as { pages: Page[]; summary: string }
}

/**
 * Extracts all {{placeholder}} keys from a template string.
 */
function extractPlaceholderKeys(html: string): string[] {
  const matches = html.match(/\{\{([^}]+)\}\}/g) ?? []
  return [...new Set(matches.map(m => m.slice(2, -2)))]
}

/**
 * runHtmlAgentFromTemplate — fills a template with content via placeholder mapping.
 *
 * Strategy (token-efficient):
 * 1. Extract the list of {{placeholder}} keys from the template (no Claude needed).
 * 2. Ask Claude to return ONLY a JSON mapping key→value (output < 2 KB regardless of template size).
 * 3. Fill the template server-side with applyPlaceholders() — no token cost for the HTML itself.
 *
 * This avoids the 50 KB template ever being sent to or returned from Claude.
 */
export async function runHtmlAgentFromTemplate(
  userRequest: string,
  plan: import('./planner').SitePlan,
  content: import('./content-agent').ContentOutput,
  design: import('./design-agent').DesignOutput,
  templateHtml: string,
  apiKey: string,
  language = 'it'
) {
  const pageContent = content.pages[0]
  const keys = extractPlaceholderKeys(templateHtml)

  const system = `Sei un esperto copywriter e SEO specialist. Ricevi una lista di placeholder da riempire per un sito web e devi restituire SOLO un oggetto JSON con i valori appropriati.

REGOLE:
- Restituisci ESCLUSIVAMENTE JSON valido — nessun testo aggiuntivo, nessun markdown.
- Usa SOLO i testi forniti nel contenuto; dove mancano (es: feature extra, piani pricing), inventa valori plausibili coerenti col brand e nella lingua indicata.
- I valori devono essere brevi e adatti all'UI (titoli ≤ 60 car, descrizioni ≤ 120 car).
- primary_color: usa il colore CSS fornito (es: "#4f46e5").
- lang: codice ISO 639-1 della lingua (es: "es", "it", "en").
- canonical_url: lascia "#".
- company_name_initial: prima lettera maiuscola del nome azienda.
- company_name_lower: nome azienda in minuscolo.`

  const userMessage = `Richiesta originale: ${userRequest}

CONTENUTO DISPONIBILE:
- Business type: ${plan.businessType}
- Lingua: ${language}
- Primary color: ${design.tokens?.colors?.primary ?? '#4f46e5'}
- Page title: ${pageContent?.title ?? ''}
- H1: ${pageContent?.h1 ?? ''}
- Meta description: ${pageContent?.metaDescription ?? ''}
- Sezioni: ${JSON.stringify(pageContent?.sections ?? [])}

PLACEHOLDER DA RIEMPIRE (ti verrà detto in ogni chiamata quali riempire):
${JSON.stringify(keys)}`

  // Split keys into batches of 30 so each Claude call stays well within token limits
  // (avoids the cut-off issue that leaves later {{placeholders}} unfilled)
  const BATCH_SIZE = 30
  const batches: string[][] = []
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    batches.push(keys.slice(i, i + BATCH_SIZE))
  }

  const callBatch = async (batchKeys: string[]): Promise<Record<string, string>> => {
    const batchTools = [{
      name: 'fill_placeholders',
      description: 'Restituisce i valori per i placeholder del batch.',
      input_schema: {
        type: 'object' as const,
        properties: Object.fromEntries(batchKeys.map(k => [k, { type: 'string' }])),
        required: batchKeys,
      },
    }]
    const batchMsg = `${userMessage}\n\nRiempi SOLO questi ${batchKeys.length} placeholder: ${JSON.stringify(batchKeys)}`
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system,
        tools: batchTools,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: batchMsg }],
      }),
    }, 'html')
    if (!res.ok) throw new Error(`HTML Template Agent error: ${await res.text()}`)
    const data = await res.json()
    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    return toolUse ? (toolUse.input as Record<string, string>) : {}
  }

  // Run all batches in parallel
  const batchResults = await Promise.all(batches.map(callBatch))
  const values = Object.assign({}, ...batchResults) as Record<string, string>

  // Fill the template server-side — no token cost
  const { applyPlaceholders } = await import('../templates/index')
  const filledHtml = applyPlaceholders(templateHtml, values)

  return {
    pages: [{ slug: 'home', name: pageContent?.title ?? 'Home', html: filledHtml }],
    summary: `Sito creato dal template con design personalizzato per ${values.company_name ?? plan.businessType}`,
  }
}

/**
 * Applies a single typed_edit to HTML without requiring the agent to generate HTML.
 * Uses regex-based approaches that work server-side without a DOM library.
 */
export function applyTypedEdit(html: string, edit: {
  type: 'css_var' | 'css_prop' | 'attr' | 'text'
  selector?: string
  var?: string
  prop?: string
  attr?: string
  value: string
}): string {
  switch (edit.type) {

    case 'css_var': {
      // Replace CSS variable value in :root { } or anywhere in <style>
      // Handles: --color-accent: #old; → --color-accent: #new;
      if (!edit.var) return html
      const varName = edit.var.replace(/^--/, '') // strip -- if user included it
      return html.replace(
        new RegExp(`(--${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*)[^;\\}]+`, 'g'),
        `$1${edit.value}`
      )
    }

    case 'css_prop': {
      // Replace a CSS property inside a selector block
      // Finds the selector in <style> and replaces the property value
      if (!edit.selector || !edit.prop) return html
      const selectorEsc = edit.selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const propEsc = edit.prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Match: selector { ...prop: oldval;... }
      return html.replace(
        new RegExp(`(${selectorEsc}\\s*\\{[^}]*${propEsc}\\s*:\\s*)[^;\\}]+`, 'g'),
        `$1${edit.value}`
      )
    }

    case 'attr': {
      // Replace an HTML attribute value on elements matching the selector
      // Handles simple selectors: .class, #id, tag, tag.class
      if (!edit.selector || !edit.attr) return html
      const attrEsc = edit.attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const valEsc = edit.value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

      // Strategy: find ALL opening tags that match the selector and swap the attribute
      const classM = edit.selector.match(/\.([a-zA-Z0-9_-]+)/)
      const idM = edit.selector.match(/#([a-zA-Z0-9_-]+)/)
      const tagM = edit.selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)

      const tagPat = tagM ? tagM[1] : '[a-zA-Z][a-zA-Z0-9]*'
      let lookAhead = ''
      if (idM) lookAhead += `(?=[^>]*id=["']${idM[1]}["'])`
      if (classM) lookAhead += `(?=[^>]*class=["'][^"']*${classM[1]}[^"']*["'])`

      // Replace attribute value in matching tags
      const tagRe = new RegExp(`(<${tagPat}\\b${lookAhead}[^>]*\\s${attrEsc}=["'])([^"']+)(["'][^>]*>)`, 'gi')
      return html.replace(tagRe, `$1${valEsc}$3`)
    }

    case 'text': {
      // Replace visible text content of an element matching the selector
      // Works for simple class/id selectors on inline text
      if (!edit.selector) return html
      const classM = edit.selector.match(/\.([a-zA-Z0-9_-]+)/)
      const idM = edit.selector.match(/#([a-zA-Z0-9_-]+)/)
      const tagM = edit.selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)

      const tagPat = tagM ? tagM[1] : '[a-zA-Z][a-zA-Z0-9]*'
      let lookAhead = ''
      if (idM) lookAhead += `(?=[^>]*id=["']${idM[1]}["'])`
      if (classM) lookAhead += `(?=[^>]*class=["'][^"']*${classM[1]}[^"']*["'])`

      const valEsc = edit.value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

      // Replace simple text node (no child tags) inside matching element
      // Pattern: <tag ...>text only, no tags<
      const textRe = new RegExp(`(<${tagPat}\\b${lookAhead}[^>]*>)([^<]+)(<)`, 'i')
      return html.replace(textRe, `$1${valEsc}$3`)
    }

    default:
      return html
  }
}

export async function runHtmlAgent(
  messages: { role: string; content: string }[],
  pages: Page[],
  activePageSlug: string | null,
  apiKey: string,
  projectMedia: Array<{ url: string; name: string; alt?: string; title?: string }> = [],
  contextLogo?: LogoDefinition,
  injectPoints?: Record<string, string>,
  userLang = 'it',
  siteLang = 'it',
  context: ProjectContext = {}
) {
  const hasPages = pages.length > 0
  const activePage = hasPages ? (pages.find(p => p.slug === activePageSlug) || pages[0]) : null

  const mediaList = projectMedia.length > 0
    ? projectMedia.map(m => `- ${m.url}${m.alt ? ` (alt: "${m.alt}")` : ''}${m.title ? ` (titolo: "${m.title}")` : ''} — file: ${m.name}`).join('\n')
    : 'Nessuna immagine caricata dall\'utente.'

  // ── Logo context ────────────────────────────────────────────────────────────
  // Priority: 1) logo extracted from existing pages HTML, 2) logo from saved design context
  const extractedLogo = pages.length > 0 ? extractNavLogo(pages[0].html) : null
  const logoSection = (() => {
    if (extractedLogo) {
      return `\nLOGO ESISTENTE — copialo IDENTICO in ogni <nav> delle pagine che crei o modifichi. NON reinventarlo:\n\`\`\`html\n${extractedLogo}\n\`\`\``
    }
    if (contextLogo) {
      const rendered = renderLogoHtml(contextLogo)
      return `\nLOGO DA USARE (dal design system) — usalo IDENTICO in ogni <nav>:\n\`\`\`html\n${rendered}\n\`\`\`\nColore logo: ${contextLogo.color}`
    }
    return ''
  })()

  // Build context: active page gets full CSS, other pages get skeleton.
  // When user asks to copy styles FROM another page, we include that page's <style> block too.
  const userMsg = messages[messages.length - 1]?.content?.toLowerCase() ?? ''

  // Detect if the request is about colors/backgrounds → include CSS in active page context
  const colorRequest = isColorOrStyleRequest(userMsg)

  // Fix 2: word-boundary match — slug/name must appear as a whole word in the message,
  // not as a substring (prevents "Funcionalidades-Factulista" matching slug="funcionalidades")
  const isDeleteRequest = /\b(elimina|rimuovi|cancella|togli|delete|remove|quita|borra|supprime|lösche)\b/i.test(userMsg)

  // Fix 7: micro-edit — targeted single-section edits (delete, round corners, single property change)
  // Identified by: delete keyword OR single-element style tweak with no image and no new section creation
  const isSingleStyleTweak = /\b(bordes?\s+redondeados?|border.radius|arrotonda|rendi\s+tondo|rounded|bold|grassetto|sottolineato|underline|font.size|dimensione\s+testo)\b/i.test(userMsg)

  // Typed-edit patterns — no HTML generation needed, surgical semantic edits
  const typedEditPatterns = [
    /\b(colou?re?|color[e]?|accent|primario|sfondo|background|tema)\b.*\b(cambi[a-z]*|modific[a-z]*|mett[a-z]*|sett[a-z]*|aggiorn[a-z]*)\b/i,
    /\b(cambi[a-z]*|modific[a-z]*)\b.*\b(colou?re?|sfondo|accent)\b/i,
    /\b(testo|text|titolo|heading|bottone|button|label|link)\b.*\b(cambi[a-z]*|modific[a-z]*|sost[a-z]*)\b/i,
    /\b(href|url|link)\b.*\b(cambi[a-z]*|aggiorn[a-z]*|punta[a-z]*)\b/i,
    /\bfont[-\s]?(size|dimensione|grandezza)\b/i,
  ]
  const isTypedEditRequest = typedEditPatterns.some(p => p.test(userMsg))

  const isMicroEdit = (isDeleteRequest || isSingleStyleTweak || isTypedEditRequest) && !hasAttachedImagesInMsg(userMsg)

  /** Returns true when the message contains an attached image URL (not a logo/asset replacement URL) */
  function hasAttachedImagesInMsg(msg: string): boolean {
    return /Immagine allegata:\s*https?:\/\//i.test(msg)
  }

  // Fix 4: asset-replacement detection — direct image URL + replacement verb = Haiku, no vision
  // (logo replacement runs were using Sonnet + 33k tokens; Haiku + find/replace src is enough)
  const isAssetReplacement = /\b(reemplaza|sostituisci|usa.*logo|logo.*usa|replace.*logo|logo.*replace|usa questa|usa questo|use this|usa il logo|usa l'immagine)\b/i.test(userMsg)
    && /https?:\/\/[^\s]+\.(png|jpg|jpeg|webp|gif|svg)/i.test(userMsg)

  // Vision from mockup: user attached an image showing a UI design/component to reproduce.
  // In this mode: strip non-active page skeletons (noise), only show section index of active page,
  // and let the model focus on the image to generate the block HTML.
  const isDesignFromMockup = hasAttachedImagesInMsg(userMsg) && !isAssetReplacement

  // Detect if the request needs nav/footer HTML (menu changes, footer edits, etc.)
  const isNavOrFooterEdit = /\b(nav|navbar|footer|menu|hamburger|menú|navigazione|navigación|mega.menu|header|cabecera|encabezado|mobile.menu)\b/i.test(userMsg)

  const mentionedPages = isDeleteRequest ? [] : pages.filter(p => {
    const slug = p.slug.toLowerCase()
    const name = p.name.toLowerCase()
    // Require word boundaries: slug/name surrounded by non-alphanumeric chars or start/end
    const wordBound = (term: string) => new RegExp(`(?<![a-z0-9])${term.replace(/[-]/g, '[\\-]')}(?![a-z0-9])`, 'i').test(userMsg)
    return wordBound(slug) || wordBound(name)
  })

  // Extract <style> block from a page's HTML
  const extractStyle = (html: string): string => {
    const match = html.match(/<style[\s\S]*?<\/style>/i)
    return match ? match[0] : ''
  }

  // Fix 1: extract only :root CSS variables for non-color requests (~20 lines vs full CSS)
  // Full CSS only for: color/style requests, or add_page-type requests (need design reference)
  const isAddPageRequest = /\b(add_page|nuova pagina|nueva página|new page|aggiungi pagina|añade página)\b/i.test(userMsg)
  const needsFullCss = colorRequest || isAddPageRequest

  const extractCssVariables = (html: string): string => {
    const styleMatch = html.match(/<style[\s\S]*?<\/style>/i)
    if (!styleMatch) return ''
    const rootMatch = styleMatch[0].match(/:root\s*\{([^}]+)\}/)
    if (!rootMatch) return ''
    return `:root {\n${rootMatch[1].trim()}\n}`
  }

  const homePage = pages.find(p => p.slug === 'home') ?? pages[0] ?? null
  const homeStyle = homePage
    ? (needsFullCss ? extractStyle(homePage.html) : extractCssVariables(homePage.html))
    : ''
  const designSystemBlock = homeStyle
    ? needsFullCss
      ? `\nDESIGN SYSTEM (CSS completo home page):\n\`\`\`css\n${homeStyle}\n\`\`\``
      : `\nDESIGN SYSTEM (variabili CSS — usa var(--...) per colori e font coerenti):\n\`\`\`css\n${homeStyle}\n\`\`\``
    : ''

  // Build per-page context blocks
  const pageContextBlocks = pages.map(p => {
    const isActive = p.slug === activePage?.slug
    const isMentioned = mentionedPages.some(mp => mp.slug === p.slug)

    if (isActive) {
      const sectionIndex = buildSectionIndex(p.html)

      // Vision from mockup: only show section index so the model knows WHERE to inject.
      // No HTML skeleton — the image IS the reference; skeleton only adds noise.
      if (isDesignFromMockup) {
        return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
SECTION INDEX (usa questi selettori per posizionare il nuovo blocco con insert_after/insert_before):
${sectionIndex}
Nota: l'HTML della pagina non è incluso — concentrati sull'immagine allegata per generare il nuovo blocco.`
      }

      // Fix 5: colorRequest no longer includes full CSS in skeleton.
      // Palette (compact color summary) + CSS vars in designSystemBlock are sufficient.
      if (colorRequest) {
        const palette = extractColorPalette(p.html)
        const colorSkeletonHtml = isNavOrFooterEdit
          ? buildHtmlSkeleton(p.html)
          : buildHtmlSkeleton(stripSharedFrame(p.html))
        const colorFrameNote = isNavOrFooterEdit
          ? ''
          : '\nNota: <nav> e <footer> omessi — sono gestiti dal sistema di frame condiviso. Se devi modificarli, indicalo esplicitamente.'
        return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
SECTION INDEX (usa questi selettori nel campo "target" delle operations):
${sectionIndex}
${colorFrameNote}
PALETTE COLORI RILEVATA (usa questi valori esatti — il CSS completo è nelle variabili sopra):
${palette}

HTML STRUTTURA:
\`\`\`html
${colorSkeletonHtml}
\`\`\``
      }

      // Fix 7: micro-edit mode — for delete/simple tasks send only the targeted section HTML
      // instead of the full page skeleton (saves 60-80% of context tokens).
      if (isMicroEdit) {
        const targetSelector = identifyTargetSection(userMsg, sectionIndex)
        if (targetSelector) {
          const sectionHtml = extractSectionHtml(p.html, targetSelector)
          if (sectionHtml) {
            return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
SECTION INDEX (tutte le sezioni della pagina):
${sectionIndex}

SEZIONE TARGET "${targetSelector}" — HTML completo (opera solo qui):
\`\`\`html
${sectionHtml}
\`\`\`
Nota: il resto della pagina non è mostrato. Usa edit_page con operations o edits su questa sezione.`
          }
        }
      }

      const skeletonHtml = isNavOrFooterEdit
        ? buildHtmlSkeleton(p.html)
        : buildHtmlSkeleton(stripSharedFrame(p.html))

      const frameNote = isNavOrFooterEdit
        ? ''
        : '\nNota: <nav> e <footer> omessi — sono gestiti dal sistema di frame condiviso. Se devi modificarli, indicalo esplicitamente.'

      return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
SECTION INDEX (usa questi selettori nel campo "target" delle operations):
${sectionIndex}
${frameNote}
HTML STRUTTURA (testi lunghi troncati — usa "operations" per sezioni intere, "edits" solo per attributi/CSS/src):
\`\`\`html
${skeletonHtml}
\`\`\``
    } else if (isMentioned) {
      // For explicitly mentioned pages: show skeleton + full <style> so agent can reference/copy CSS
      const styleBlock = extractStyle(p.html)
      return `\n=== PAGINA CITATA: "${p.name}" (slug: "${p.slug}") ===
HTML STRUTTURA:
\`\`\`html
${buildHtmlSkeleton(p.html)}
\`\`\`
${styleBlock ? `CSS COMPLETO (per copiare stili da questa pagina):
\`\`\`css
${styleBlock}
\`\`\`` : ''}`
    } else {
      return `- "${p.name}" (slug: "${p.slug}") — disponibile per modifica`
    }
  }).join('\n')

  // Fix 6: micro-edit mode — condensed system prompt for delete/simple-tweak tasks.
  // Omits component library docs, parametric components, and verbose rules that waste
  // tokens when the agent only needs to apply a small targeted change.
  const microEditPrefix = `Sei un esperto web designer. Modifichi pagine HTML esistenti con chirurgia minima.

🚫 REGOLA ANTI-REGRESSIONE — STILE INTOCCABILE:
Aggiungi SOLO l'elemento richiesto. NON toccare mai CSS/stile/colori/font/layout di elementi non coinvolti.
Usa le classi CSS già esistenti nel sito. L'eccezione: l'utente dice esplicitamente "cambia colore/stile/design".

REGOLE:
- Usa SEMPRE edit_page (non create_site, non add_page).
- Preferisci "operations" (selector-based) per sezioni intere; usa "edits" (find/replace) per CSS/attributi/testi brevi.
- Tocca SOLO l'elemento richiesto — non riscrivere HTML non coinvolto.
- summary in ${langName(userLang)}.
- 🎯 SCOPE DICHIARATO: nel campo "scope" di edit_page, elenca SOLO le sezioni che stai effettivamente modificando.
- ✅ PREFERISCI typed_edits per: colori (css_var), font-size (css_prop), link href (attr), testi brevi (text) — NON generare HTML per questi casi.`

  const fullPrefix = `Sei un esperto web designer. Crei e modifichi siti web MULTI-PAGINA in HTML puro.

🔍 REGOLA TESTO ESATTO — PRIMA DI MODIFICARE UN ELEMENTO:
Se l'utente chiede di modificare un bottone, link o testo specifico (es: "il bottone Activar PRO") e non trovi quel testo ESATTO nell'HTML:
1. NON generare un edit vuoto (0 operations, 0 edits) — causa confusione all'utente
2. Cerca varianti simili nell'HTML (maiuscole/minuscole, spazi extra, testo parziale)
3. Se trovi una variante simile → applicala
4. Se non trovi nulla di simile → usa typed_edits con "attr" o "text" specificando il selettore CSS invece del testo
5. Solo come ultima risorsa: usa il campo summary per spiegare che non hai trovato l'elemento e chiedi il testo esatto

🚫 REGOLA ANTI-REGRESSIONE — STILE INTOCCABILE SALVO RICHIESTA ESPLICITA:

Quando l'utente chiede di aggiungere/modificare un campo form, un bottone, un link, o qualsiasi elemento HTML:
1. Aggiungi SOLO l'elemento HTML nuovo — nient'altro.
2. NON modificare MAI il <style>, i colori, i font, padding, margin, border-radius o qualsiasi proprietà CSS di elementi non direttamente coinvolti.
3. Per posizionare il nuovo elemento, usa le classi CSS già esistenti nel sito (es: class="btn btn-primary") — NON inventare nuove classi né aggiungere style inline se non strettamente necessario.
4. Se devi aggiungere un attributo, usa typed_edits (attr, text) — non rigenerare il blocco HTML.

L'unica eccezione: l'utente usa esplicitamente parole come "cambia colore", "modifica lo stile", "aggiorna il design", "rendi più grande", "usa un altro font". Solo allora puoi toccare il CSS.

In caso di dubbio: MENO È MEGLIO. La modifica minima è sempre quella corretta.

QUALITÀ HTML — REGOLE ANTI-REGRESSIONE (errori comuni da NON ripetere):
- ❌ MAI usare classi Tailwind CSS (text-4xl, md:text-5xl, font-bold, leading-tight, ecc.) — il sito usa CSS custom, non Tailwind. Usa SOLO le classi definite nel <style> della pagina o variabili CSS (var(--accent), var(--font), ecc.).
- ❌ MAI lasciare elementi vuoti (<h2><p><br></p></h2>, <div></div>, <p></p>, ecc.) — rimuovili prima di finalizzare l'output.
- ❌ MAI duplicare dichiarazioni CSS sullo stesso selettore (es: background: #fff; poi background: #000 sullo stesso blocco) — tieni solo l'ultima versione.
- ❌ MAI mettere un <p> dentro un <h1>/<h2>/<h3> — HTML invalido che rompe SEO e screen reader.
- ❌ MAI includere attributi stile con CSS custom properties di Tailwind (--tw-border-spacing-x, --tw-translate-x, ecc.) — questi non hanno effetto e gonfiano l'HTML.
- ❌ MAI aggiungere script di listener (scroll, messaggi, ecc.) che sono già iniettati dal sistema — genera solo il contenuto HTML/CSS della sezione, non ripetere script infrastrutturali.
- ✅ Gerarchia heading corretta: un solo H1 per pagina, poi H2, poi H3 — senza salti di livello.
- ✅ Quando modifichi CSS, rimuovi le dichiarazioni precedenti dello stesso attributo nello stesso selettore.
- ❌ MAI hardcodare URL assoluti nei tag <link rel="canonical"> o <meta property="og:url"> — usa SEMPRE il placeholder {{site_url}}/SLUG (es: href="{{site_url}}/precios"). Il sistema lo sostituisce con l'URL reale a runtime. URL hardcodati tipo "https://sito.com/preview/..." vengono indicizzati da Google in modo errato.
- ❌ MAI usare tipi Schema.org inesistenti in JSON-LD. Tipi validi comuni: WebPage, WebSite, Organization, SoftwareApplication, Product, Offer, FAQPage, BreadcrumbList, Article, BlogPosting. Evita tipi inventati come "PriceComponent", "FeaturePage", "SaasApp".
- ❌ MAI nidificare elementi block (<div>, <section>, <ul>, <table>) dentro <p> — HTML invalido che i browser gestiscono in modo imprevedibile. Spezza il <p> in elementi separati o usa <div> come contenitore.
- ✅ Mobile menu: usa SEMPRE la classe CSS "open" (non "active") per il toggle del menu mobile — sia nel CSS (.mobile-menu.open { display: flex; }) sia nello script JavaScript (classList.toggle('open')). Questo mantiene coerenza tra tutte le pagine del sito.
- ❌ MAI usare tag HTML obsoleti: <strike> → usa <s> o <del>; <font> → usa CSS; <center> → usa CSS text-align:center; <tt> → usa <code>; <big> → usa CSS font-size; <b> puramente decorativo → usa <strong>; <i> puramente decorativo → usa <em>. I tag obsoleti abbassano il punteggio SEO e vengono segnalati dagli strumenti di analisi.
- ✅ Quando generi una <form> per raccogliere contatti o lead, usa SEMPRE questo pattern JavaScript:
  ```
  fetch('/api/forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipo:'contacto',nombre:...,email:...,empresa:...,mensaje:...})})
  .then(function(r){return r.ok?r.json():Promise.reject(r.status);})
  .then(function(data){
    if(data&&data.redirectUrl){window.location.href=data.redirectUrl;return;}
    status.textContent=(data&&data.confirmMessage)||'¡Mensaje enviado! Te responderemos pronto.';
    status.style.display='block';form.reset();
  })
  ```
  La risposta può contenere `redirectUrl` (reindirizza l'utente) o `confirmMessage` (testo custom) configurati nel pannello Componenti.

REGOLE CRITICHE:
- Nessun sito? Usa create_site (includi sempre pagina "home").
- Modifiche a pagina esistente: usa edit_page con find/replace mirati.
- Nuova pagina: usa add_page. Eliminare pagina: usa delete_page (non "home").
- 🎯 SCOPE DICHIARATO: nel campo "scope" di edit_page, elenca SOLO le sezioni che stai effettivamente modificando. Se l'utente chiede una modifica puntuale (es. "cambia il testo del bottone"), scope deve contenere solo quella sezione — mai l'intera pagina.
- ✅ PREFERISCI typed_edits per: colori (css_var), font-size (css_prop), link href (attr), testi brevi (text) — NON generare HTML per questi casi.
- add_page — REGOLA FONDAMENTALE: genera SOLO il contenuto specifico della pagina. NAV e FOOTER vengono iniettati automaticamente dal sistema (dalla home page) — NON includerli MAI. Struttura obbligatoria: <!DOCTYPE html><html lang="..."><head>[meta SEO]</head><body><main style="padding-top:var(--nav-height,64px)">[sezioni della pagina]</main></body></html>. DEVI includere un <style> completo per i componenti specifici (layout, sezioni, card, tabelle, ecc.) usando var(--accent), var(--bg), var(--text), var(--font), ecc. per colori e font coerenti col brand.
- MAI creare una pagina con slug "blog". Il blog è gestito da un sistema dinamico separato. Se l'utente vuole il blog, aggiungi SOLO il link <a href="./blog">Blog</a> nella nav — non creare la pagina.
- Per modificare l'intestazione/hero/testo della PAGINA BLOG (la sezione sopra gli articoli), usa update_blog_header — NON edit_page.
- Per inserire embed/iframe/script/widget (newsletter, analytics, pixel, cookie banner, ecc.) usa set_inject_point — NON edit_page. Scegli lo slot corretto: head per CSS/script globali, body_end per pixel/widget, blog_post_bottom per CTA post-articolo, blog_list_bottom per embed dopo la lista articoli.

TARGETING DELLA PAGINA — IMPORTANTISSIMO:
- Se l'utente nomina esplicitamente una pagina (es: "nella pagina precios", "sulla pagina contatti", "per la pagina about"), usa edit_page su QUELLA pagina — NON sulla pagina attiva.
- "Anche nella pagina X" = edita la pagina X.
- Se l'utente dice "fai X come nella home" = la home è il RIFERIMENTO (sorgente), non il target da editare.
- La pagina attiva è solo il default quando l'utente non specifica.

LOGO — REGOLE FONDAMENTALI:
- Se è indicato un "LOGO ESISTENTE" qui sotto, copialo VERBATIM in ogni <nav>. Non modificarne struttura, colori o contenuto salvo richiesta esplicita.
- Se l'utente chiede di cambiare colore al logo SVG, usa edit_page con find/replace sul valore fill (es: find fill="#000000" replace fill="#2563eb"). Non riscrivere tutto l'HTML.
- Se l'utente carica un'immagine logo (URL in media library), sostituisci l'elemento logo con <img src="URL" alt="logo" style="height:36px;width:auto;">.
- Quando crei un sito nuovo senza logo definito, crea un logo testuale semplice: <a href="./" class="nav-logo" style="font-size:1.4rem;font-weight:800;color:[colore_coerente];text-decoration:none;">[nome brand]</a>. Puoi colorare un carattere con l'accent color.
- Il logo DEVE essere identico su tutte le pagine del sito.

COLORI E SFONDI — REGOLE CRITICHE:
- Quando la richiesta è SOLO di cambio colore testo (es: "le scritte del footer le vedo grigie, rendile bianche", "il testo non si vede"): usa find/replace ESCLUSIVAMENTE sul CSS — NON toccare la struttura HTML. Preferisci modificare il selettore CSS (es: 'footer { color: #fff; }') o la variabile in :root. MAI riscrivere l'HTML del footer/sezione.
- Quando l'utente dice "metti lo stesso sfondo/colore che c'è in X" o "uguale al grigio attorno" o simili:
  1. Leggi la sezione PALETTE COLORI (o il blocco <style>) per trovare il valore esatto del colore di sfondo della pagina/sezione circostante.
  2. Controlla prima le CSS custom properties (:root), poi le regole background-color per selettori come body, .section, .container, ecc.
  3. Usa il valore ESATTO trovato (es: #f8f7f4, #f5f5f5, var(--color-bg), ecc.) — non inventare valori.
  4. Per cambiare sfondo via CSS (regola nella <style>): usa find/replace sulla regola CSS, es: find 'background: #ffffff' replace 'background: #f8f7f4'.
  5. Se il background è inline (style="background:#fff"): trova l'elemento corretto nell'HTML e sostituisci solo l'attributo background nella stringa style.
  6. Se non riesci a trovare il colore esatto, segnalalo nella summary e usa il colore più simile che vedi nella palette.

COME MODIFICARE UNA PAGINA — SCEGLI IL MODO GIUSTO:

▸ INSERIRE O SOSTITUIRE UNA SEZIONE INTERA → usa "operations" in edit_page (SEMPRE preferibile):
  - Il campo "target" accetta selettori CSS dal SECTION INDEX mostrato nel contesto della pagina.
  - Selettore: "tag#id.class" — es: "section#pricing", "footer.site-footer", "header", "section.features"
  - op="insert_after": aggiunge la sezione dopo il blocco target
  - op="insert_before": aggiunge prima del blocco target
  - op="replace": sostituisce l'intero blocco target col nuovo HTML
  - Esempio: aggiungere sezione moduli dopo pricing →
    { op: "insert_after", target: "section#pricing", html: "<section id='modules'>…</section>" }
  - VANTAGGIO: immune al troncamento — funziona sempre, non importa quanto sia lungo il testo.

▸ MODIFICHE CHIRURGICHE (CSS, src immagine, attributo, testo breve univoco) → usa "edits":
  - Le stringhe "find" si applicano sull'HTML originale COMPLETO (non sullo skeleton troncato).
  - NON usare MAI testo visibile (paragrafi, titoli) come "find" — potrebbe essere troncato. Usa ancore strutturali: attributi id="...", class="...", src="...", o tag di chiusura.
  - Per immagini: trova/sostituisci SOLO il src → find: 'src="vecchio.jpg"' replace: 'src="nuovo.jpg"'
  - Per CSS: trova la regola CSS esatta → find: 'background: #fff' replace: 'background: #f5f5f5'
  - Fallback "inserisci prima di </main>": SOLO se non esiste un selettore valido nel section index →
    find: '</main>'  replace: '<section class="nuova">…</section>\n</main>'

▸ REGOLA RIASSUNTIVA: operations > edits. Usa edits solo quando stai modificando un attributo, un valore CSS, o un testo di pochi caratteri sicuramente univoco nell'HTML.

LINK TRA PAGINE: usa link relativi senza .html — es: <a href="./">Home</a>, <a href="./chi-siamo">Chi Siamo</a>

OGNI PAGINA: HTML completo, CSS inline, mobile-friendly, design moderno e coerente tra pagine.

SEO — REGOLE DI DEFAULT (applica SEMPRE su ogni pagina che crei o modifichi):
- <title> presente, 50–60 chars, con keyword primaria. Formato: "Keyword — Brand" o "Brand | Servizio".
- <meta name="description"> presente, 150–160 chars, termina con CTA.
- <link rel="canonical" href="{{site_url}}/PAGE_SLUG"> — usa SEMPRE {{site_url}} come radice dell'URL; aggiungi lo slug della pagina (home → {{site_url}}/, about → {{site_url}}/about, blog → {{site_url}}/blog, ecc.).
- <meta property="og:url" content="{{site_url}}/PAGE_SLUG"> — stessa logica di canonical.
- NON usare mai URL assoluti inventati (es: https://miodominio.com) — usa SOLO {{site_url}}.
- <html lang="[LINGUA]"> — usa la lingua del sito (it/es/en/...).
- Un solo <h1> per pagina, contenente la keyword principale.
- Gerarchia heading corretta: H1→H2→H3 senza salti.
- Tag semantici: <header>, <nav>, <main>, <footer>.
- Ogni <img> ha: alt="[descrizione]", width, height, loading="lazy" (tranne la prima above-the-fold).
- <link rel="preconnect" href="https://fonts.googleapis.com"> se usi Google Fonts.
- og:title, og:description nella <head> (og:image se hai URL immagine).
- Schema.org JSON-LD: usa {{site_url}} come valore del campo "url" (es: "@id": "{{site_url}}", "url": "{{site_url}}").
Queste regole si applicano ANCHE alle modifiche parziali: se aggiungi una sezione, assicurati che la pagina soddisfi questi requisiti.

PERFORMANCE — REGOLE OBBLIGATORIE (impattano Core Web Vitals e ranking SEO):
- Google Fonts: usa SEMPRE il parametro display=swap nell'URL → ?display=swap. Esempio: href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap". NON omettere mai display=swap.
- Google Fonts preconnect: aggiungi SEMPRE entrambe queste righe PRIMA del link al font:
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
- LCP image (hero): la prima immagine above-the-fold NON deve avere loading="lazy". Aggiungi invece:
  <link rel="preload" as="image" href="[URL_IMMAGINE_HERO]"> nel <head>.
  Attributo fetchpriority="high" sull'elemento <img> stesso.
- Tutte le altre immagini: loading="lazy" + width + height espliciti (previene CLS).
- Script non critici: aggiungi sempre defer o async — mai script bloccanti nel <head>.
- Nessuna risorsa esterna non necessaria: non caricare librerie JS (jQuery, Bootstrap JS, ecc.) se non strettamente necessarie. CSS inline > CDN esterno.

IMMAGINI ALLEGATE — REGOLA CRITICA:
Quando l'utente allega un'immagine, hai TRE comportamenti distinti:
A) L'immagine contiene TESTO (screenshot di dati, lista prezzi, articolo, menu, scheda prodotto, tabella, documento):
   → LEGGI tutto il testo visibile nell'immagine e usalo per RIEMPIRE il contenuto HTML (titoli, paragrafi, prezzi, voci, descrizioni).
   → NON usare l'URL dell'immagine come src di <img>. Il testo è il contenuto, non l'immagine.
B) L'utente chiede ESPLICITAMENTE di inserire/mostrare quell'immagine (es: "metti questa foto", "usa questo logo"):
   → Usa l'URL come src di <img> normalmente.
C) L'immagine mostra un DESIGN / MOCKUP / COMPONENTE UI (layout, sezione, wireframe, screenshot di sito altrui):
   → ANALIZZA la struttura visiva: posizionamento elementi, grid/flex layout, proporzioni, gerarchie tipografiche.
   → RIPRODUCI il design in HTML usando le CSS custom properties del sito (--color-accent, --font-heading, ecc.) per colori e font — NON copiare i colori dell'immagine alla lettera.
   → Usa edit_page con op="insert_after" o "insert_before" per iniettarlo nella posizione giusta della pagina.
   → Genera SOLO il blocco HTML richiesto (section, div, card, ecc.) — non riscrivere la pagina intera.

In caso di dubbio: se l'immagine ha testo leggibile → A; se l'utente dice "metti/usa questa immagine" → B; altrimenti → C.

IMMAGINI — REGOLE DI PRIORITÀ (importante):
1. Se l'utente fornisce un URL esplicito nel messaggio → USA QUELL'URL ESATTO.
2. Se l'utente chiede di usare "una sua immagine" e la media library ha qualcosa di pertinente → usa quegli URL.
3. Altrimenti → usa placeholder https://picsum.photos/seed/{keyword}/{w}/{h}.

LIBRERIA COMPONENTI DISPONIBILI:
Quando l'utente chiede di aggiungere uno di questi elementi, integra il componente HTML fornito adattandolo al design del sito (usa i colori, font e stile del sito — sostituisci le classi "grey/placeholder" con quelle coerenti al design system). Usa edit_page per iniettarlo nella posizione giusta della pagina.
- logo-carousel: striscia loghi infinita
- faq-accordion: FAQ espandibili
- contact-form: form di contatto
- newsletter-form: form iscrizione email
- cookie-banner: banner GDPR cookie
- pricing-toggle: prezzi mensile/annuale
- data-table: tabella dati/confronto

COMPONENTI PARAMETRICI (usa il tool insert_component invece di generare HTML da zero!):
Questi componenti sono pre-costruiti e ricevono solo i dati. Risparmiano TANTI token e garantiscono consistenza visiva. Usali appena il pattern combacia.

▸ nav-feature-dropdown — Mega-menu nella nav (trigger + griglia di funzionalità).
  Caso d'uso tipico: "voglio una dropdown nella nav con le voci Facturación, Contabilidad, …"
  placement: replace-nav-link, targetText="Funcionalidades" (testo del link nav esistente)
  NOTA: replace-nav-link funziona anche per AGGIORNARE un mega menu già presente — usa lo stesso targetText del triggerLabel del menu esistente (es. "Funcionalidades").
  data: {
    triggerLabel: string         // testo che resta visibile nella nav
    columns?: 1|2|3|4            // colonne nel pannello (default 2)
    items: Array<{ label, href, icon?, badge? }>
  }
  icon = nome icona built-in (stringa) — NON usare emoji. Icone disponibili:
    invoice, document, chart, analytics, users, team, money, treasury,
    box, inventory, crm, settings, calendar, reports, mail, card, payments,
    integrations, security, star, lightning, dashboard, ticket
  badge = "TOP" | "NUEVO" | "NEW" | "BETA" | ecc.

▸ feature-grid — Sezione full-width con griglia di cards funzionalità.
  Caso d'uso tipico: pagina /funcionalidades che lista tutti i prodotti.
  placement: end-of-body o before-footer (per aggiungerla), oppure replace-selector
  data: {
    title: string
    subtitle?: string
    columns?: 1|2|3|4            // default 3
    items: Array<{ label, href?, icon?, description?, badge? }>
  }

ESEMPIO completo (mega-menu): se l'utente dice «nella nav voglio una dropdown "Funcionalidades" con Facturación, Contabilidad, Tesorería, Equipo, Inventario, CRM, Proyectos», passa pageSlugs con TUTTE le pagine che hanno la nav così la modifica appare ovunque in un solo colpo:
insert_component({
  pageSlugs: ["home","precios","contacto","blog-page-if-exists", /* tutte le pagine del sito */],
  componentId: "nav-feature-dropdown",
  placement: "replace-nav-link",
  targetText: "Funcionalidades",
  data: {
    triggerLabel: "Funcionalidades",
    columns: 2,
    items: [
      {label:"Facturación", href:"./facturacion", icon:"invoice", badge:"TOP"},
      {label:"Contabilidad", href:"./contabilidad", icon:"chart", badge:"TOP"},
      {label:"Tesorería", href:"./tesoreria", icon:"treasury"},
      {label:"Equipo", href:"./equipo", icon:"users"},
      {label:"Inventario", href:"./inventario", icon:"box"},
      {label:"CRM", href:"./crm", icon:"crm"},
      {label:"Proyectos", href:"./proyectos", icon:"dashboard"}
    ]
  },
  summary: "Aggiunto mega-menu Funcionalidades su tutte le pagine"
})

MEDIA LIBRARY DEL PROGETTO:
${mediaList}
${logoSection}
INJECTION POINTS ATTIVI:
${(() => {
  const active = Object.entries(injectPoints ?? {}).filter(([, v]) => v && v.trim())
  if (active.length === 0) return 'Nessun punto di iniezione configurato.'
  return active.map(([slot, html]) => `- ${slot}: ${html.slice(0, 80)}${html.length > 80 ? '…' : ''}`).join('\n')
})()}
Usa set_inject_point per aggiungere/aggiornare/rimuovere embed, script o iframe in questi slot — senza toccare l'HTML delle pagine.

${buildContextPrompt(context)}

${designSystemBlock}

PAGINE DEL SITO:
${pageContextBlocks}

${isDesignFromMockup ? `⚠️ MOCKUP ALLEGATO: l'immagine mostra un design da riprodurre. Analizza struttura, layout e proporzioni. Riproduci in HTML usando le CSS vars del sito. Usa edit_page con "operations" (insert_after/insert_before) per iniettare il blocco nella pagina. Genera SOLO il nuovo blocco — non riscrivere la pagina.

` : ''}HTML COMPATTO: non inserire mai righe vuote nell'HTML. Ogni riga deve avere contenuto — nessuna riga blank tra tag o sezioni.

⚠️ LINGUA DEL SITO: il sito è in **${langName(siteLang)}**. TUTTI i testi HTML (nav, sezioni, pulsanti, etichette, titoli) devono SEMPRE restare in ${langName(siteLang)}. NON tradurre mai testi esistenti anche se l'utente scrive in un'altra lingua. Se aggiungi nuovi contenuti HTML, scrivili in ${langName(siteLang)}.
LINGUA RISPOSTA CHAT: l'utente sta scrivendo in **${langName(userLang)}**. Il campo \`summary\` DEVE essere in ${langName(userLang)} — ma l'HTML del sito rimane sempre in ${langName(siteLang)}.`

  // Fix 6: micro-edit system prompt — much shorter, omits component library & verbose rules.
  // Used when isMicroEdit===true (delete / simple style tweak without images).
  const microSystem = `${microEditPrefix}

COME MODIFICARE — scegli il modo giusto:

▸ SEZIONE INTERA (elimina elemento, sostituisci blocco) → usa "operations" in edit_page:
  target: selettore CSS dal SECTION INDEX (es: "nav", "section#pricing", "footer.site-footer")
  op: "replace" per sostituire, "insert_after"/"insert_before" per aggiungere.
  Usa op="replace" con html="" per ELIMINARE una sezione.
  ⚠️ Per eliminare un singolo link/item DENTRO una sezione (es: voce di menu), usa "edits" find/replace su quell'elemento specifico — non replace dell'intera sezione.

▸ ELEMENTO SINGOLO (voce menu, link, attributo, CSS) → usa "edits" (find/replace):
  find: usa ancore strutturali (href, class, id, src) — mai testo lungo che potrebbe essere troncato.
  Esempio elimina link menu: find '<a href="./pagina">Testo</a>' replace ''

${buildContextPrompt(context)}

${designSystemBlock}

PAGINE DEL SITO:
${pageContextBlocks}

HTML COMPATTO: nessuna riga vuota nell'HTML.
⚠️ LINGUA DEL SITO: ${langName(siteLang)}. NON tradurre testi HTML esistenti anche se l'utente scrive in ${langName(userLang)}. Nuovi contenuti HTML → in ${langName(siteLang)}. Campo \`summary\` → in ${langName(userLang)}.`

  const system = isMicroEdit ? microSystem : fullPrefix

  // Send only the last 6 messages (3 exchanges) to avoid ballooning history tokens
  const recentMessages = messages.slice(-6)

  // Build API messages — if the last user message has attached images, fetch them
  // as base64 and pass them as multimodal content so the model can actually SEE them
  // (text extraction, reading data, etc.) instead of just seeing an opaque URL.
  type TextBlock = { type: 'text'; text: string }
  type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  type MsgContent = string | (TextBlock | ImageBlock)[]

  const apiMessages: { role: string; content: MsgContent }[] = await Promise.all(
    recentMessages.map(async (m, i) => {
      const isLastUser = i === recentMessages.length - 1 && m.role === 'user'
      if (!isLastUser) return { role: m.role, content: m.content }

      const attachedUrls = extractImageUrls(m.content)
      if (attachedUrls.length === 0) return { role: m.role, content: m.content }

      // Fix 4: asset-replacement tasks (logo/image URL already in message + replacement verb)
      // don't need vision — skip base64 fetch, keep text-only → Haiku instead of Sonnet.
      // Saves ~30k tokens and ~$0.05 per run on logo-replacement requests.
      if (isAssetReplacement) return { role: m.role, content: m.content }

      const fetched = await Promise.all(attachedUrls.map(fetchImageAsBase64))
      const validImages = fetched.filter((img): img is NonNullable<typeof img> => img !== null)
      if (validImages.length === 0) return { role: m.role, content: m.content }

      // Build multimodal content: images first, then the text prompt
      const content: (TextBlock | ImageBlock)[] = [
        ...validImages.map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
        })),
        { type: 'text' as const, text: m.content },
      ]
      return { role: m.role, content }
    })
  )

  // Use Sonnet when images are attached (better vision/OCR than Haiku).
  // Asset-replacement tasks already skipped base64 above → will use Haiku.
  const hasImages = apiMessages.some(m => Array.isArray(m.content))
  const model = hasImages ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001'

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      system,
      tools: HTML_TOOLS,
      tool_choice: { type: 'any' },
      messages: apiMessages,
    }),
  }, 'html')

  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`)
  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool use in response')

  // Strip blank lines from all HTML outputs before returning
  const inp = toolUse.input as Record<string, unknown>
  if (typeof inp.html === 'string') inp.html = stripBlankLines(inp.html)
  if (Array.isArray(inp.pages)) {
    inp.pages = (inp.pages as Array<Record<string, unknown>>).map(p =>
      typeof p.html === 'string' ? { ...p, html: stripBlankLines(p.html) } : p
    )
  }
  if (Array.isArray(inp.edits)) {
    inp.edits = (inp.edits as Array<Record<string, unknown>>).map(e => ({
      ...e,
      ...(typeof e.replace === 'string' ? { replace: stripBlankLines(e.replace) } : {}),
    }))
  }
  if (Array.isArray(inp.operations)) {
    inp.operations = (inp.operations as Array<Record<string, unknown>>).map(op => ({
      ...op,
      ...(typeof op.html === 'string' ? { html: stripBlankLines(op.html) } : {}),
    }))
  }

  // Apply typed_edits first (most surgical, no HTML generation needed).
  // We resolve them server-side by applying each edit to the target page HTML
  // and converting the result into a find/replace edit so the client applies it normally.
  const typedEdits = (inp.typed_edits ?? []) as Array<{
    type: 'css_var' | 'css_prop' | 'attr' | 'text'
    selector?: string; var?: string; prop?: string; attr?: string; value: string
  }>
  if (typedEdits.length > 0 && toolUse.name === 'edit_page') {
    const targetSlug = inp.pageSlug as string | undefined
    const targetPage = targetSlug ? pages.find(p => p.slug === targetSlug) : null
    if (targetPage) {
      let html = targetPage.html
      const syntheticEdits: Array<{ find: string; replace: string }> = []
      for (const te of typedEdits) {
        const next = applyTypedEdit(html, te)
        if (next !== html) {
          // Find the first differing region and emit a find/replace pair.
          // This is safe because applyTypedEdit makes precise, localized changes.
          // We diff at line granularity to keep find strings short and unambiguous.
          const oldLines = html.split('\n')
          const newLines = next.split('\n')
          for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
            if (oldLines[i] !== newLines[i]) {
              const findStr = oldLines[i] ?? ''
              const replStr = newLines[i] ?? ''
              if (findStr && findStr !== replStr) {
                syntheticEdits.push({ find: findStr, replace: replStr })
              }
              break
            }
          }
          html = next
        }
      }
      if (syntheticEdits.length > 0) {
        inp.edits = [...(inp.edits as Array<{ find: string; replace: string }> ?? []), ...syntheticEdits]
      }
    }
    // typed_edits have been resolved — remove them so the client doesn't re-apply
    delete inp.typed_edits
  }

  return { tool: toolUse.name, input: inp, usage: data.usage }
}

/** Remove blank lines from HTML — keeps output compact and readable in the code view. */
function stripBlankLines(html: string): string {
  // Collapse any sequence of consecutive blank/whitespace-only lines into nothing.
  // A single newline between tags is preserved for readability.
  return html.replace(/\n(\s*\n)+/g, '\n')
}
