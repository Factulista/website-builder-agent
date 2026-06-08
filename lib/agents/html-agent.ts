import { callClaude } from './config'
import { fetchWithRetry } from './fetch-retry'
import { extractImageUrls } from './site-analyzer'
import type { LogoDefinition } from './design-agent'
import { langName } from './detect-lang'
import { buildRichContextPrompt, type ProjectContext, type RichContext } from './memory-agent'
import { splitHtmlIntoBlocks, buildBlockIndex, findBlockBySelector, editBlock as editBlockFn } from './block-splitter'
import type { Block } from '../types'

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

type Page = { slug: string; name: string; html: string; blocks?: Block[] }

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
    name: 'validate_html',
    description: 'Valida l\'HTML generato prima di salvarlo. Controlla H1 multipli, inline style, img senza alt, link assoluti. Chiama questo tool dopo ogni edit_page o create_site prima di restituire il risultato finale.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: { type: 'string', description: 'HTML da validare' },
        pageSlug: { type: 'string', description: 'Slug della pagina (per il contesto)' },
      },
      required: ['html'],
    },
  },

  // Skill tools removed — Sonnet-4.6 handles design/SEO/content natively
  // with full HTML context. No separate agents needed.
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
  // ── Block tools (Fase 1) — read/edit individual blocks, not full page ──
  {
    name: 'read_block',
    description: 'Legge l\'HTML di UN SINGOLO blocco della pagina attiva (nav, section#hero, footer, ecc.). Usa SEMPRE questo invece di leggere tutta la pagina — contesto minimo, massima precisione. Restituisce i byte esatti del blocco con numeri di riga.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockSelector: { type: 'string', description: 'Il selettore del blocco dall\'indice (es: "section#hero", "footer.site-footer", "nav"). Usa esattamente come appare nell\'indice.' },
        pageSlug: { type: 'string', description: 'Slug della pagina. Se omesso usa la pagina attiva.' },
      },
      required: ['blockSelector'],
    },
  },
  {
    name: 'edit_block',
    description: 'Modifica UN blocco con find/replace validato. Il server conta le occorrenze PRIMA di applicare: 0=non trovato (riceve hint), >1=ambiguo (allarga l\'ancora), 1=applica. Usa SEMPRE questo per modifiche chirurgiche — mai l\'intera pagina.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockSelector: { type: 'string', description: 'Selettore del blocco target dall\'indice.' },
        pageSlug: { type: 'string', description: 'Slug della pagina. Se omesso usa la pagina attiva.' },
        find: { type: 'string', description: 'Stringa ESATTA da trovare (copia dai byte di read_block, non ricostruire a memoria).' },
        replace: { type: 'string', description: 'Stringa con cui sostituire.' },
        summary: { type: 'string' },
      },
      required: ['blockSelector', 'find', 'replace', 'summary'],
    },
  },
  {
    name: 'replace_block',
    description: 'Sostituisce l\'intero HTML di UN blocco (rigenerazione creativa). Usa quando devi ridisegnare una sezione intera (es: "ridisegna l\'hero"). Tocca solo quel blocco — il resto della pagina è immune.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockSelector: { type: 'string', description: 'Selettore del blocco da sostituire.' },
        pageSlug: { type: 'string', description: 'Slug della pagina. Se omesso usa la pagina attiva.' },
        html: { type: 'string', description: 'Nuovo HTML completo del blocco.' },
        summary: { type: 'string' },
      },
      required: ['blockSelector', 'html', 'summary'],
    },
  },

  // ── Inspection tools (read-only) — used in the agentic loop BEFORE acting ──
  {
    name: 'search_html',
    description: 'ISPEZIONE (non modifica nulla). Cerca testo, classi CSS, attributi o selettori nell\'HTML delle pagine PRIMA di modificare. Usalo quando l\'utente nomina un elemento (bottone, link, sezione) di cui non conosci il testo/classe esatti, o che non vedi nel contesto. Restituisce gli snippet HTML attorno alle corrispondenze, con la pagina in cui si trovano. Dopo aver trovato l\'elemento, chiama edit_page con i valori esatti.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Cosa cercare: parte del testo visibile (es: "PRUEBA GRATIS"), una classe (es: "nav-cta"), un attributo (es: \'href="./precios"\'). Usa termini brevi e specifici.' },
        pageSlug: { type: 'string', description: 'Opzionale: limita la ricerca a una pagina. Se omesso, cerca in TUTTE le pagine.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_page',
    description: 'ISPEZIONE (non modifica nulla). Restituisce l\'HTML completo di una pagina specifica. Usalo per ispezionare in dettaglio una pagina diversa da quella attiva (di cui vedi solo lo scheletro) prima di modificarla.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pageSlug: { type: 'string', description: 'Slug della pagina da leggere (es: "precios", "contacto").' },
      },
      required: ['pageSlug'],
    },
  },

  // ── Fase 4: single-agent tools replacing separate agent calls ──────────────
  {
    name: 'run_seo_audit',
    description: 'Esegue un audit SEO completo su tutte le pagine del sito: title, meta description, H1, heading hierarchy, alt immagini, schema.org, performance. Restituisce score + lista problemi. Usalo quando l\'utente chiede di migliorare il SEO, controllare i meta tag, o ottimizzare per Google.',
    input_schema: {
      type: 'object' as const,
      properties: {
        applyFixes: {
          type: 'boolean',
          description: 'Se true, applica automaticamente le correzioni critiche (title mancante, H1 mancante, meta description). Se false, restituisce solo il report. Default: false.',
        },
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_design',
    description: 'Aggiorna il CSS globale del sito (design system) — palette colori, font, spacing, variabili :root. Usalo quando l\'utente vuole cambiare colori, tipografia, o lo stile generale senza toccare le singole pagine. NON usare edit_page per cambiar variabili CSS globali — usa questo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        changes: {
          type: 'string',
          description: 'Descrizione testuale dei cambiamenti richiesti (es: "colore primario da #4F46E5 a #DC2626", "font heading: Playfair Display"). L\'agente CSS interpreterà e applicherà.',
        },
        css: {
          type: 'string',
          description: 'CSS diretto da applicare (optional). Se fornito, sovrascrive il CSS condiviso attuale. Includere il blocco :root { } con le variabili modificate.',
        },
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
  },
]

/**
 * Execute a read-only inspection tool server-side. Returns a text result that is
 * fed back to the model as a tool_result, so it can gather context before acting.
 */
function executeHtmlInspection(
  name: string,
  input: Record<string, unknown>,
  pages: Page[]
): string {
  // ── Block tools ──────────────────────────────────────────────────────────────
  if (name === 'read_block') {
    const { splitHtmlIntoBlocks, findBlockBySelector } = require('../agents/block-splitter') as typeof import('./block-splitter')
    const pageSlug = input.pageSlug ? String(input.pageSlug) : null
    const selector = String(input.blockSelector ?? '')
    const p = pageSlug ? pages.find(pg => pg.slug === pageSlug) : pages[0]
    if (!p) return `Pagina non trovata.`
    const blocks = p.blocks ?? splitHtmlIntoBlocks(p.html) ?? []
    const block = findBlockBySelector(blocks, selector)
    if (!block) {
      const idx = blocks.map(b => `  [${b.order}] ${b.selector} (${b.type})`).join('\n')
      return `Blocco "${selector}" non trovato. Blocchi disponibili:\n${idx}`
    }
    // Return with line numbers for precise find anchoring
    const lines = block.html.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n')
    return `Blocco "${block.selector}" (id:${block.id}, ~${Math.round(block.html.length/4)} token):\n\`\`\`html\n${lines}\n\`\`\``
  }

  if (name === 'edit_block') {
    // edit_block is an ACTION tool — handled in the route, not here.
    // If it ends up here something is wrong.
    return 'edit_block è un tool di azione — non un tool di ispezione.'
  }

  if (name === 'replace_block') {
    return 'replace_block è un tool di azione — non un tool di ispezione.'
  }

  // ── Inspection tools ─────────────────────────────────────────────────────────
  if (name === 'search_html') {
    const query = String(input.query ?? '').trim()
    if (!query) return 'Errore: query vuota.'
    const pageSlug = input.pageSlug ? String(input.pageSlug) : null
    const targets = pageSlug ? pages.filter(p => p.slug === pageSlug) : pages
    if (targets.length === 0) {
      return `Nessuna pagina con slug "${pageSlug}". Pagine disponibili: ${pages.map(p => p.slug).join(', ')}.`
    }
    const q = query.toLowerCase()
    const matches: string[] = []
    for (const p of targets) {
      const lower = p.html.toLowerCase()
      let idx = lower.indexOf(q)
      let count = 0
      while (idx !== -1 && count < 4) {
        const start = Math.max(0, idx - 140)
        const end = Math.min(p.html.length, idx + query.length + 140)
        const snippet = p.html.slice(start, end).replace(/\s+/g, ' ').trim()
        matches.push(`[pagina: ${p.slug}] …${snippet}…`)
        idx = lower.indexOf(q, idx + query.length)
        count++
      }
    }
    if (matches.length === 0) {
      return `Nessuna corrispondenza per "${query}". Prova un termine più corto, una classe o un attributo. Pagine disponibili: ${pages.map(p => p.slug).join(', ')}.`
    }
    return `Trovate ${matches.length} corrispondenze per "${query}" (usa i valori ESATTI qui sotto per il find/replace):\n${matches.join('\n\n')}`
  }
  if (name === 'read_page') {
    const pageSlug = String(input.pageSlug ?? '')
    const p = pages.find(pg => pg.slug === pageSlug)
    if (!p) return `Pagina "${pageSlug}" non trovata. Disponibili: ${pages.map(pg => pg.slug).join(', ')}.`
    const html = p.html.length > 14000 ? p.html.slice(0, 14000) + '\n…[HTML troncato a 14k caratteri]' : p.html
    return `HTML completo di "${pageSlug}":\n\`\`\`html\n${html}\n\`\`\``
  }
  return `Tool di ispezione sconosciuto: ${name}`
}

// read_block is both inspection (gets data) and transition to action (edit_block/replace_block).
// Treat it as inspection so the loop continues after the agent reads a block.
const INSPECTION_TOOL_NAMES = new Set(['search_html', 'read_page', 'read_block'])

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
  context: ProjectContext = {},
  richContext?: Omit<RichContext, 'context'>,
  previewSelection?: { blockSelector: string; anchorText: string; outerHtml: string } | null,
  visibleBlocks?: string[]
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

  // true when design is being created (not edited): create_site or add_page.
  // Used to inject design principles, select Sonnet, enable extended thinking.
  const isCreationTask = !hasPages || isAddPageRequest

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
  // Track whether a block was pre-loaded for the active page (set inside pages.map below).
  // Used to skip inspection steps when the agent already has the exact block bytes.
  let activePageBlockPreloaded = false

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

      // ── Fase 1: Block-aware context ──────────────────────────────────────────
      // If the page has blocks (or we can split it), send ONLY the block index
      // (~50 tokens) + the selected/relevant block (~5k tokens) instead of the
      // full HTML (73k tokens). The agent uses read_block/edit_block/replace_block.
      // Falls back to full HTML if blocks aren't available or the page is small.
      const pageBlocks: Block[] = p.blocks ?? splitHtmlIntoBlocks(p.html) ?? []
      const useBlockMode = pageBlocks.length >= 3  // only worth it for multi-block pages

      if (useBlockMode && !isNavOrFooterEdit) {
        const blockIdx = buildBlockIndex(pageBlocks)

        // Pre-load the most relevant block:
        // Priority 1: explicit click in preview
        // Priority 2: visible block matching message intent
        // Priority 3: if message contains image URL → pre-load hero/header block (most common target)
        let selectedBlock = previewSelection?.blockSelector
          ? findBlockBySelector(pageBlocks, previewSelection.blockSelector)
          : null

        // Auto-detect image insertion: pre-load the first content block (hero/header/section)
        // so the agent has exact bytes without needing read_block first
        if (!selectedBlock && hasImageUrlInText) {
          const heroBlock = pageBlocks.find(b =>
            b.type === 'header' ||
            b.selector.includes('hero') ||
            b.selector.includes('banner') ||
            (b.type === 'section' && b.order === (pageBlocks.filter(x => x.type !== 'style' && x.type !== 'script').sort((a,b) => a.order - b.order)[0]?.order))
          ) ?? pageBlocks.filter(b => b.type !== 'style' && b.type !== 'script').sort((a,b) => a.order - b.order)[0] ?? null
          if (heroBlock) selectedBlock = heroBlock
        }

        // Visible blocks fallback
        if (!selectedBlock && visibleBlocks?.length) {
          selectedBlock = findBlockBySelector(pageBlocks, visibleBlocks[0]) ?? null
        }

        const preloadLabel = previewSelection?.blockSelector ? 'BLOCCO CLICCATO' :
          hasImageUrlInText ? 'BLOCCO TARGET (rilevato automaticamente per inserimento immagine)' :
          'BLOCCO VISIBILE'

        const preloadedBlock = selectedBlock
          ? `\n${preloadLabel} — usa edit_block o replace_block su questo:\n\`\`\`html\n${selectedBlock.html.slice(0, 8000)}\n\`\`\``
          : ''

        // Signal to outer scope: active page has a block pre-loaded → no inspection needed
        if (selectedBlock) activePageBlockPreloaded = true

        return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
BLOCK INDEX (usa read_block per leggere un blocco, edit_block/replace_block per modificarlo):
${blockIdx}
${preloadedBlock}
ISTRUZIONI:
- USA read_block → edit_block/replace_block per ogni modifica (NON edit_page sull'HTML completo)
- Ogni edit_block valida il match prima di applicare — usa byte esatti da read_block
- Per modifiche globali (CSS var, font) usa edit_page con typed_edits`
      }

      // Fallback: pass FULL HTML (small pages, nav/footer edits, or no blocks)
      const fullHtml = isNavOrFooterEdit ? p.html : stripSharedFrame(p.html)
      const frameNote = isNavOrFooterEdit
        ? ''
        : '\nNota: <nav> e <footer> sono gestiti dal frame condiviso — modificali solo se esplicitamente richiesto.'

      return `\n=== PAGINA ATTIVA: "${p.name}" (slug: "${p.slug}") ===
SECTION INDEX (selettori per operations):
${sectionIndex}
${frameNote}
HTML COMPLETO:
\`\`\`html
${fullHtml}
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

🔍 ISPEZIONA PRIMA DI AGIRE: hai search_html e read_page (sola lettura, non modificano nulla).
Se l'utente nomina un elemento (bottone, link, voce di menu) che NON vedi nel contesto o di cui non conosci il testo/classe esatti → chiama PRIMA search_html({query:"..."}) per trovarlo, poi usa i valori ESATTI per edit_page. Non indovinare mai: cerca. Puoi fare più ricerche di fila.

REGOLE:
- Usa SEMPRE edit_page (non create_site, non add_page).
- Preferisci "operations" (selector-based) per sezioni intere; usa "edits" (find/replace) per CSS/attributi/testi brevi.
- Tocca SOLO l'elemento richiesto — non riscrivere HTML non coinvolto.
- NON restituire mai un edit vuoto: se non trovi l'elemento, ISPEZIONA con search_html invece di arrenderti.
- summary in ${langName(userLang)}.
- 🎯 SCOPE DICHIARATO: nel campo "scope" di edit_page, elenca SOLO le sezioni che stai effettivamente modificando.
- ✅ PREFERISCI typed_edits per: colori (css_var), font-size (css_prop), link href (attr), testi brevi (text) — NON generare HTML per questi casi.`

  // Design principles block — injected only for creation tasks (create_site / add_page).
  // Not included in micro-edit or standard edit_page: it adds tokens with no benefit there.
  const designPrinciplesBlock = isCreationTask ? `
PRINCIPI DI DESIGN — IDENTITÀ VISIVA (applica su ogni sito che crei da zero):

TRADUZIONE BUSINESS → PALETTE:
- Ristorante / food: terracotta #C27A5A, avorio #F8F3ED, verde muschio #4A6741 — caldo, appetitoso
- Studio legale / consulenza: navy #1E3A5F, slate #64748B, bianco #F8FAFC — sobrio, autorevole
- Tech / SaaS: indigo #4F46E5, slate #0F172A, bianco #F8FAFC — innovativo, chiaro
- Benessere / yoga: salvia #7D9B76, beige #F5EFE6, écru #E8DCC8 — naturale, calmo
- Lusso / gioielleria: nero #0A0A0A, gold #C9A84C, avorio #F8F5F0 — elegante, esclusivo
- Artigianato / handmade: terracotta #C4704A, crema #FAF3E8, marrone #4A3728 — autentico, caldo
- Clinica / salute: celeste #E0F2FE, blu medico #0284C7, bianco #FFFFFF — pulito, rassicurante
- Immobiliare: grafite #2D3748, oro #B7935A, bianco #F7F7F5 — premium, affidabile
Se il business non rientra in una categoria, scegli una palette da 3 colori: 1 brand + 1 accent + 2 neutri.

TIPOGRAFIA — MAX 2 FONT GOOGLE:
- Lusso / eleganza: Cormorant Garamond + Jost; oppure Playfair Display + Inter
- Tech / moderno: Inter + Inter; oppure DM Sans + DM Mono (monospace accent)
- Artigianato / calore: Fraunces + Lato; oppure Crimson Pro + Source Sans 3
- Corporate / professionale: Libre Baskerville + Source Sans 3; oppure Merriweather + Open Sans
- Minimalista: Inter weight 300/700 da solo; oppure Plus Jakarta Sans
Regola: heading = personalità del brand; body = massima leggibilità. Mai più di 2 font.

SPAZIO E GERARCHIA:
- Sezioni separate da padding 80px–120px. Whitespace abbondante = qualità percepita.
- H1: 3rem–4.5rem, weight 700–800. Deve dominare la pagina.
- H2: 1.8rem–2.4rem, weight 600–700. Chiaro ma subordinato a H1.
- P: 1rem–1.1rem, line-height 1.6–1.8. Mai inferiore a 0.9rem.
- Bottoni: padding 12px 28px minimum. Sempre con border-radius coerente al brand (0 = formale, 8px = moderno, 999px = friendly).

LAYOUT HERO:
- Prima sezione: impatto visivo immediato. H1 + sottotitolo + CTA. Mai solo testo.
- Full-height hero (100vh): per luxury/portfolio. Impatto massimo.
- Split hero (50/50 img+testo): per SaaS/corporate. Equilibrato, professionale.
- Centered hero: per startup/landing. Pulito, focalizzato.

CONSISTENZA:
- Tutti i colori via var(--accent), var(--bg), var(--text), var(--surface). MAI valori hard-coded nel CSS delle sezioni.
- Border-radius identico su tutti i bottoni e card. Decidi UNA misura e usala ovunque.
- Bottoni filled per CTA primario. Outline per secondario. Mai due filled diversi colorati.
` : ''

  const fullPrefix = `Sei un esperto web designer. Crei e modifichi siti web MULTI-PAGINA in HTML puro.
${designPrinciplesBlock}
🔍 ISPEZIONA PRIMA DI AGIRE (loop agentico — come un vero sviluppatore):
Hai due strumenti di SOLA LETTURA che NON modificano nulla: search_html e read_page.
USALI PRIMA di modificare ogni volta che NON sei sicuro al 100% del testo/classe/attributo esatto:
1. L'utente nomina un bottone/link/sezione (es: "il bottone PRUEBA GRATIS") che non vedi o di cui non conosci il testo esatto → chiama search_html({query:"PRUEBA GRATIS"}) per trovarlo, poi usa i valori ESATTI restituiti per edit_page.
2. Devi modificare una pagina diversa da quella attiva (vedi solo lo scheletro) → chiama read_page({pageSlug:"..."}) per vederne l'HTML completo, poi modificala.
3. Non trovi un elemento → search_html con un termine più corto, una classe, o un attributo (href/class/id) PRIMA di arrenderti.
Puoi fare più ispezioni di fila. Il sistema ti restituisce i risultati e tu decidi la mossa successiva.

REGOLA TESTO ESATTO — quando finalmente modifichi:
1. NON generare MAI un edit vuoto (0 operations, 0 edits). Se non hai trovato l'elemento, ISPEZIONA ancora con search_html.
2. Usa i valori ESATTI trovati con search_html per le stringhe find/replace.
3. Per attributi/testi brevi preferisci typed_edits (attr/text) con il selettore CSS.
4. Solo dopo aver davvero ispezionato senza risultato: usa summary per chiedere il testo esatto all'utente.

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
- ✅ Quando generi una <form> per raccogliere contatti o lead, usa SEMPRE il pattern JavaScript:
  fetch('/api/forms') con POST, Content-Type application/json.
  Body: {tipo:'contacto', nombre, email, empresa, mensaje, 'cf-turnstile-response': tokenValue}
  Response: se contiene redirectUrl, usa setTimeout(2000) poi window.location.href; se confirmMessage, mostralo.
  Se il sito ha Cloudflare Turnstile configurato (site key nel pannello Componenti), aggiungi:
  1. Script: <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  2. Widget dentro la form: <div class="cf-turnstile" data-sitekey="SITE_KEY" data-theme="light"></div>
  3. Nel JS prima del fetch: var token = document.querySelector('[name=cf-turnstile-response]')?.value ?? ''
  Senza site key: ometti il widget e non includere cf-turnstile-response nel body.

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

REGOLE SPECIFICHE DI QUESTO PROGETTO (non deducibili dal codice):
- Menu mobile: usa classe CSS "open" per il toggle (classList.toggle('open')), mai "active". Il CSS deve avere .mobile-menu.open { display: flex; }
- Link interni: SEMPRE href="./slug" (relativi con ./) — mai href="/slug" (assoluti)
- Form contatti: usa fetch('/api/forms') POST con JSON {tipo, nombre, email, empresa, mensaje}. Se c'è Cloudflare Turnstile, aggiungi il widget e 'cf-turnstile-response' nel body
- Colori via CSS vars: usa var(--accent), var(--bg), var(--text), var(--font) per coerenza col brand
- Blog: mai creare pagina con slug "blog" — è un sistema dinamico separato. Aggiungi solo <a href="./blog"> nella nav
- SEO placeholder: usa {{site_url}} per URL assoluti nei meta tag (canonical, og:url, schema.org) — il sistema lo sostituisce a runtime

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

${buildRichContextPrompt({ context, ...richContext })}

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

${buildRichContextPrompt({ context, ...richContext })}

${designSystemBlock}

PAGINE DEL SITO:
${pageContextBlocks}

HTML COMPATTO: nessuna riga vuota nell'HTML.
⚠️ LINGUA DEL SITO: ${langName(siteLang)}. NON tradurre testi HTML esistenti anche se l'utente scrive in ${langName(userLang)}. Nuovi contenuti HTML → in ${langName(siteLang)}. Campo \`summary\` → in ${langName(userLang)}.`

  // ── Preview context signal (edit only) ──────────────────────────────────────
  // Two automatic signals — no user action required:
  //
  // Priority 1: explicit click (previewSelection) — user clicked an element.
  //   Use this block, use the anchor text as exact find bytes.
  //
  // Priority 2: visible blocks (visibleBlocks) — IntersectionObserver tracks
  //   which structural blocks are in viewport when the user starts typing.
  //   No click needed. Agent knows "user was looking at section#pricing".
  //
  // Only injected for edit tasks (hasPages=true). Creation tasks don't need it.
  let previewContextHint = ''
  if (hasPages) {
    if (previewSelection?.blockSelector) {
      previewContextHint = `\n\n🎯 BLOCCO CLICCATO (priorità massima — l'utente ha cliccato qui):
Selettore: ${previewSelection.blockSelector}
Testo ancora (bytes ESATTI): "${previewSelection.anchorText.slice(0, 120)}"
→ Se il messaggio è deittico ("questo", "qui", "quello lì"), opera SU QUESTO blocco.
→ Usa read_block("${previewSelection.blockSelector}") per ottenere i byte completi.`
    } else if (visibleBlocks && visibleBlocks.length > 0) {
      previewContextHint = `\n\n👁 BLOCCHI VISIBILI A SCHERMO (viewport dell'utente al momento dell'invio):
${visibleBlocks.slice(0, 5).join(', ')}
→ Se il messaggio si riferisce a qualcosa di visibile ("quello in cima", "la sezione sotto"), probabilmente è uno di questi.
→ Non è un click esplicito — usa il messaggio per capire quale blocco target.`
    }
  }

  // ── Lean edit system prompt (~8k tokens vs fullPrefix ~20k) ─────────────────
  // Strip component library, design system CSS, blog posts, injection points.
  // Only what the agent needs to modify a specific block.
  const editSystem = `Sei un esperto web developer. Modifichi HTML con precisione chirurgica.

STRUMENTI:
- edit_block(blockSelector, find, replace, summary) — modifica testo/attributo in un blocco. USA SEMPRE QUESTO per prima scelta.
- replace_block(blockSelector, html, summary) — sostituisce un blocco intero (solo se devi ridisegnarlo).
- edit_page(pageSlug, edits, operations, typed_edits, summary) — per modifiche multi-blocco o CSS.
- read_block(blockSelector) — leggi un blocco per ottenere i byte esatti (solo se non pre-caricato).

REGOLE:
1. BLOCCO PRE-CARICATO presente → usa quei byte ESATTI per il find. Non inventare.
2. find = stringa presente UNA SOLA VOLTA nel blocco. Mai troncare.
3. Non toccare nav/footer salvo richiesta esplicita.
4. HTML compatto: zero righe vuote.
5. Lingua sito: ${langName(siteLang)}. Summary in: ${langName(userLang)}.
${logoSection ? '\n' + logoSection : ''}
PAGINE DEL SITO:
${pageContextBlocks}
${previewContextHint}`

  // Route to the right system prompt:
  // - Creation/mockup: fullPrefix — needs full context (components, design, blog)
  // - Micro-edit: microSystem — already minimal
  // - Edit: editSystem — lean, ~8k tokens (allows 6 req/min on Tier 1 50k TPM)
  const system = isCreationTask || isDesignFromMockup ? fullPrefix + previewContextHint
    : isMicroEdit ? microSystem + previewContextHint
    : editSystem  // previewContextHint already embedded in editSystem

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

  const hasImages = apiMessages.some(m => Array.isArray(m.content))

  // Detect image URL in message text (e.g. Supabase storage URL pasted by user).
  // These require HTML structure reasoning — Haiku often fails to insert them correctly.
  const hasImageUrlInText = /https?:\/\/[^\s"']+\.(?:png|jpg|jpeg|webp|gif|svg|avif)/i.test(userMsg)

  // ── Fase 3a: Block-aware adaptive model routing ──────────────────────────────
  //
  // Routing table:
  //   Haiku  → edit_block on text/style/CSS changes (surgical, no HTML structure judgment)
  //   Sonnet → everything that requires HTML structure reasoning:
  //            - image URL in message (inserting image into section = layout judgment)
  //            - create_site / add_page / replace_block
  //            - vision tasks
  //            - monolith edits (full page context)
  const activePageForRouting = pages.find(p => p.slug === activePageSlug) ?? pages[0] ?? null
  const pageHasBlocks = (activePageForRouting?.blocks?.length ?? 0) >= 3
  const isBlockEdit = pageHasBlocks && !isCreationTask && !isAddPageRequest && !hasImages && !hasImageUrlInText

  // Temporarily use Sonnet for everything — Haiku routing disabled until reliability confirmed
  const model = 'claude-sonnet-4-5-20250929'

  // Extended thinking: only on first site creation (zero pages) where design judgment
  // matters most. Disabled on Tier 1 — re-enable when on Tier 2+.
  const useExtendedThinking = false

  // ── Fase 3a: Block-aware adaptive max_tokens ──────────────────────────────
  //
  // With block mode, edit output is ~200-500 tokens (find/replace or block HTML).
  // We no longer need to budget for full-page output on edits.
  //
  // Tiers (updated for block mode):
  //   1k  — edit_block: find/replace output, microscopically small
  //   4k  — micro-edit: typed_edits, delete, small CSS changes
  //   6k  — replace_block: one section HTML (avg 2-4k, 6k is safe ceiling)
  //   12k — standard edit_page on monolith (add/replace a section)
  //   24k — add_page: full new page
  //   32k — create_site ≤3 pages or vision mockup
  //   64k — first site (0 pages) or large create_site
  const pageCount = pages.length
  const maxTokens = (() => {
    if (isMicroEdit)                          return  4_000
    if (isDesignFromMockup)                   return 32_000
    if (!hasPages)                            return 64_000
    if (isAddPageRequest)                     return 24_000
    if (hasImages)                            return 32_000
    if (isBlockEdit)                          return  6_000  // block edit: small output
    if (pageCount === 0)                      return 64_000
    if (pageCount <= 3)                       return 32_000
    if (pageCount <= 6)                       return 48_000
    return 12_000
  })()

  // ── Agentic inspection loop ──────────────────────────────────────────────
  // Like Claude Code: the model may call read-only inspection tools (search_html,
  // read_page) to gather context BEFORE committing to an action. Each inspection
  // runs server-side and its result is fed back, letting the model iterate until
  // it calls an action tool (edit_page, create_site, …). This is what turns the
  // agent from a blind one-shot guesser into one that looks before it acts.
  //
  // Inspection is only offered when there are pages to inspect (not on first-site
  // creation). On the final allowed step, inspection tools are removed so the model
  // is forced to produce a concrete action.
  // Inspection steps = extra Anthropic API calls = extra 429 hits.
  // On Tier 1 (5 RPM), even 2 calls per message causes rate limits.
  // Rule: edit tasks → 0 inspection steps (block is pre-loaded server-side, act directly).
  //       creation tasks → 1 step max (may need to check existing structure).
  const MAX_INSPECTION_STEPS = isCreationTask ? 1 : 0
  // Offer inspection only when there are pages to inspect and no images in play
  // (vision tasks analyze an image to generate — re-sending it each loop is wasteful).
  const offerInspection = hasPages && !isDesignFromMockup && !hasImages

  // Prompt caching: the system prompt is identical across all loop steps (and across
  // back-to-back requests on the same project). Marking it cacheable means inspection
  // ── Fase 3b: 3-level cache strategy ──────────────────────────────────────────
  //
  // Level 1 — STATIC (tools + guardrails + design principles):
  //   Changes only on code deploy. Largest block (~8-12k tokens). Cache TTL 5 min.
  //   Re-used across ALL users of the platform on the same org key.
  //
  // Level 2 — SEMI-STATIC (design system + project rules + session memory):
  //   Changes only when user edits Design System or AI learns new rules.
  //   Stays warm for the entire editing session (5+ min TTL easily met).
  //
  // Level 3 — DYNAMIC (block index + preloaded block + media library):
  //   Changes every request. Small in block mode (~2-6k). Not worth caching
  //   on single turn, but cached within the agentic loop (inspection steps 2+).
  //
  // Split boundaries: markers that reliably separate the levels.
  const SEMI_STATIC_MARKERS = ['DESIGN SYSTEM', 'REGOLE DI PROGETTO', 'SESSION MEMORY', 'MEMORIA DI SESSIONE']
  const DYNAMIC_MARKERS = ['MEDIA LIBRARY DEL PROGETTO:', 'PAGINE DEL SITO:', 'PAGINE ATTUALI:', 'BLOCK INDEX', 'BLOCCHI VISIBILI', 'BLOCCO PRE-CARICATO']

  const findFirstIdx = (markers: string[]) =>
    markers.reduce((min, mk) => { const i = system.indexOf(mk); return i > -1 && i < min ? i : min }, system.length)

  const semiStaticIdx = findFirstIdx(SEMI_STATIC_MARKERS)
  const dynamicIdx    = findFirstIdx(DYNAMIC_MARKERS)

  // Ensure ordering: static < semi-static < dynamic
  const s1end = Math.min(semiStaticIdx, dynamicIdx)
  const s2end = Math.min(dynamicIdx, system.length)

  const staticPart     = system.slice(0, s1end).trim()
  const semiStaticPart = s1end < s2end ? system.slice(s1end, s2end).trim() : ''
  const dynamicPart    = system.slice(s2end).trim()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const systemBlocks: any = staticPart.length >= 100
    ? [
        { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
        ...(semiStaticPart.length >= 50 ? [{ type: 'text', text: semiStaticPart, cache_control: { type: 'ephemeral' } }] : []),
        ...(dynamicPart   ? [{ type: 'text', text: dynamicPart }] : []),  // dynamic: no cache (changes every turn)
      ]
    : system
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loopMessages: any[] = [...apiMessages]
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolUse: any = null
  const inspectionTrail: string[] = []

  for (let step = 0; step <= MAX_INSPECTION_STEPS; step++) {
    const isLastStep = step === MAX_INSPECTION_STEPS
    // Offer inspection tools only while inspecting and not on the forced-action step
    const toolsForStep = (offerInspection && !isLastStep)
      ? HTML_TOOLS
      : HTML_TOOLS.filter(t => !INSPECTION_TOOL_NAMES.has(t.name))

    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-beta': useExtendedThinking
          ? 'interleaved-thinking-2025-05-14,prompt-caching-2024-07-31'
          : 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: useExtendedThinking ? 1 : undefined,
        ...(useExtendedThinking ? { thinking: { type: 'enabled', budget_tokens: 8000 } } : {}),
        system: systemBlocks,
        tools: toolsForStep,
        tool_choice: { type: 'any' },
        messages: loopMessages,
      }),
    }, 'html')

    if (!res.ok) {
      // 429: rate limit — throw a specific error so the route can show a friendly message
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after')
        const waitSec = retryAfter ? Math.ceil(parseInt(retryAfter, 10)) : 30
        throw new Error(`RATE_LIMIT:${waitSec}`)
      }
      throw new Error(`Anthropic API error: ${await res.text()}`)
    }
    data = await res.json()

    // Accumulate usage across all loop steps for accurate billing
    const u = (data.usage ?? {}) as Record<string, number>
    totalUsage.input_tokens += u.input_tokens ?? 0
    totalUsage.output_tokens += u.output_tokens ?? 0
    totalUsage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
    totalUsage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0

    toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) throw new Error('No tool use in response')

    // Action tool → exit the loop and let the downstream logic handle it
    if (!INSPECTION_TOOL_NAMES.has(toolUse.name)) break

    // Inspection tool → execute server-side, feed the result back, and iterate
    const inspectionResult = executeHtmlInspection(toolUse.name, toolUse.input as Record<string, unknown>, pages)
    inspectionTrail.push(`🔍 ${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 80)})`)
    loopMessages.push({ role: 'assistant', content: data.content })
    loopMessages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: inspectionResult }],
    })
  }

  // Replace per-call usage with the accumulated total so credits reflect all steps
  data.usage = totalUsage
  if (inspectionTrail.length > 0) {
    console.log(`[agentic-loop] ${inspectionTrail.length} inspection step(s): ${inspectionTrail.join(' → ')}`)
  }

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

  // If agent called validate_html, run it and feed result back for correction
  if (toolUse.name === 'validate_html') {
    const html = inp.html as string ?? ''
    const issues = runHtmlValidation(html)
    const validationResult = issues.length === 0
      ? '✅ HTML valido — nessun problema rilevato.'
      : `Problemi trovati:\n${issues.join('\n')}\nCorreggi questi problemi e salva la pagina.`

    // Feed validation result back and get the corrected tool call
    // (loopMessages includes any inspection history from the agentic loop)
    const correctionMessages = [
      ...loopMessages,
      { role: 'assistant' as const, content: data.content },
      {
        role: 'user' as const,
        content: [{
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: validationResult,
        }],
      },
    ]
    const corrRes = await callClaude('html', system, correctionMessages as { role: string; content: string }[], HTML_TOOLS, apiKey)
    if (corrRes.ok) {
      const corrData = await corrRes.json()
      const corrTool = corrData.content?.find((b: { type: string }) => b.type === 'tool_use')
      if (corrTool) return { tool: corrTool.name, input: corrTool.input, usage: corrData.usage }
    }
  }

  // ── Skill tool handlers removed — base model handles these natively ─────

  if (toolUse.name === 'update_design_globally') {
    const instruction = inp.instruction as string
    const summary = inp.summary as string ?? 'Design aggiornato'
    try {
      const { runDesignAgentUpdate } = await import('./design-agent')
      // Collect current CSS from home page
      const home = pages.find(p => p.slug === 'home') ?? pages[0]
      const currentCss = home
        ? (home.html.match(/<style[\s\S]*?<\/style>/gi) ?? []).map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
        : ''
      const designResult = await runDesignAgentUpdate(instruction, currentCss, apiKey, context)
      if (designResult?.css) {
        // Apply updated CSS to all pages by replacing their <style> block
        const updatedPages = pages.map(p => {
          const newHtml = p.html.replace(/<style>[\s\S]*?<\/style>/, `<style>${designResult.css}</style>`)
          return { ...p, html: newHtml }
        })
        return {
          tool: 'update_shared_css',
          input: { pages: updatedPages, shared_css: designResult.css, summary: designResult.summary ?? summary },
          usage: data.usage,
        }
      }
    } catch (err) {
      console.error('[master] update_design_globally skill failed:', err)
    }
    return { tool: toolUse.name, input: inp, usage: data.usage }
  }

  if (toolUse.name === 'update_seo_meta') {
    const instruction = inp.instruction as string
    const pageSlugs = inp.pageSlugs as string[] | undefined
    const summary = inp.summary as string ?? 'SEO ottimizzato'
    const targetPages = pageSlugs?.length
      ? pages.filter(p => pageSlugs.includes(p.slug))
      : pages
    try {
      const { runSeoAgent } = await import('./seo-agent')
      const seoResult = await runSeoAgent(
        [{ role: 'user', content: instruction }],
        targetPages, null, apiKey, context
      )
      if (seoResult) {
        return { tool: seoResult.tool, input: { ...seoResult.input, summary }, usage: data.usage }
      }
    } catch (err) {
      console.error('[master] update_seo_meta skill failed:', err)
    }
    return { tool: toolUse.name, input: inp, usage: data.usage }
  }

  if (toolUse.name === 'rewrite_content') {
    const instruction = inp.instruction as string
    const pageSlug = inp.pageSlug as string
    const summary = inp.summary as string ?? 'Contenuto riscritto'
    const targetPage = pages.find(p => p.slug === pageSlug)
    if (targetPage) {
      try {
        const { runContentAgentUpdate } = await import('./content-agent')
        const contentResult = await runContentAgentUpdate(instruction, [targetPage], apiKey, context)
        if (contentResult?.pages?.[0]) {
          const newPage = contentResult.pages[0]
          return {
            tool: 'create_site',
            input: {
              pages: pages.map(p => p.slug === pageSlug ? newPage : p),
              summary: contentResult.summary ?? summary,
            },
            usage: data.usage,
          }
        }
      } catch (err) {
        console.error('[master] rewrite_content skill failed:', err)
      }
    }
    return { tool: toolUse.name, input: inp, usage: data.usage }
  }

  return { tool: toolUse.name, input: inp, usage: data.usage }
}

/** Validate HTML and return array of issue strings (empty = valid) */
function runHtmlValidation(html: string): string[] {
  const issues: string[] = []
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length
  if (h1Count > 1) issues.push(`⚠️ ${h1Count} tag <h1> trovati — deve essere esattamente 1`)
  if (h1Count === 0) issues.push('⚠️ Nessun <h1> trovato — obbligatorio per SEO')
  const inlineStyles = (html.match(/\bstyle="/gi) ?? []).length
  if (inlineStyles > 0) issues.push(`⚠️ ${inlineStyles} attributi style="" inline — usa il Design System CSS`)
  const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) ?? []).length
  if (imgNoAlt > 0) issues.push(`⚠️ ${imgNoAlt} <img> senza attributo alt=""`)
  if (/href="\/[^"#?]/.test(html)) issues.push('⚠️ Link interni assoluti (href="/...") — usa href="./slug"')
  return issues
}

/** Remove blank lines from HTML — keeps output compact and readable in the code view. */
function stripBlankLines(html: string): string {
  // Collapse any sequence of consecutive blank/whitespace-only lines into nothing.
  // A single newline between tags is preserved for readability.
  return html.replace(/\n(\s*\n)+/g, '\n')
}
