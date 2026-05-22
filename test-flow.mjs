/**
 * E2E test — simulates a real user flow:
 *   1. "Fammi un sito per Factulista SaaS fatturazione in spagna"  → pipeline (home)
 *   2. "Crea la pagina prezzi"                                      → pipeline (add page)
 *   3. "Crea la pagina contatti"                                    → pipeline (add page)
 *   4. "Crea la pagina chi siamo"                                   → pipeline (add page)
 *   5. "Crea la pagina riferimenti / testimonial"                   → pipeline (add page)
 *
 * Run: node test-flow.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ── Load .env.local ──────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const API_KEY = envContent.match(/ANTHROPIC_API_KEY=(.+)/)?.[1]?.trim()
if (!API_KEY) { console.error('❌  ANTHROPIC_API_KEY not found in .env.local'); process.exit(1) }
console.log('✅  API key loaded\n')

// ── Helpers ──────────────────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m' }

function log(color, ...args) { console.log(color + args.join(' ') + C.reset) }
function ok(msg)   { log(C.green,  '  ✅ ', msg) }
function warn(msg) { log(C.yellow, '  ⚠️  ', msg) }
function err(msg)  { log(C.red,    '  ❌ ', msg) }
function info(msg) { log(C.cyan,   '  ℹ️  ', msg) }
function dim(msg)  { log(C.gray,   '     ', msg) }

function printPages(pages) {
  pages.forEach(p => {
    const navLinks = (p.html.match(/href=["'][^"']*["']/g) || []).map(h => h.replace(/href=["']|["']/g, ''))
    const hasNav = /<nav[\s\S]*?<\/nav>/i.test(p.html)
    console.log(`     📄 ${p.slug.padEnd(20)} nav:${hasNav ? '✓' : '✗'}  links:[${navLinks.filter(l => !l.startsWith('http') && !l.startsWith('#')).join(', ')}]`)
  })
}

// ── classify (mirrors orchestrator logic without importing TS) ────────────────
const CREATE_KW = ['crea', 'genera', 'costruisci', 'fai', 'fammi', 'nuovo sito', 'nuova homepage', 'rifai', 'ricrea', 'da zero', 'make me', 'create', 'build', 'generate', 'voglio un sito', 'voglio una pagina', 'ho bisogno di un sito']
const SEO_KW    = ['seo', 'meta', 'sitemap', 'robots', 'canonical', 'indicizzazione']
const DESIGN_KW = ['colore', 'palette', 'font', 'stile', 'tema', 'restyle', 'cambia aspetto', 'cambia design']
const CONTENT_KW = ['riscrivi', 'tono di voce', 'più formale', 'più informale', 'traduci']
const IMAGES_KW  = ['immagini', 'foto', 'alt text', 'ottimizza immagini']

function classify(msg, hasPages) {
  const lower = msg.toLowerCase()
  if (!hasPages || CREATE_KW.some(k => lower.includes(k))) return 'pipeline'
  if (IMAGES_KW.some(k => lower.includes(k)))  return 'images'
  if (SEO_KW.some(k => lower.includes(k)))      return 'seo'
  if (DESIGN_KW.some(k => lower.includes(k)))   return 'design-update'
  if (CONTENT_KW.some(k => lower.includes(k)))  return 'content-update'
  return 'html'
}

// ── Detect language (mirrors orchestrator) ────────────────────────────────────
const LANG_PATTERNS = {
  it: ['italia', 'italiano', 'italiani'],
  es: ['spagna', 'spagnolo', 'spagnoli', 'españa', 'autonomos', 'pyme', 'for spain', 'spanish'],
  en: ['england', 'english', 'uk', 'usa', 'united states', 'american'],
  de: ['germany', 'german', 'deutschland', 'tedesco'],
  fr: ['france', 'french', 'français', 'francese'],
}
function detectLang(msg) {
  const lower = msg.toLowerCase()
  for (const [lang, patterns] of Object.entries(LANG_PATTERNS)) {
    if (patterns.some(p => lower.includes(p))) return lang
  }
  return null
}

// ── Lightweight pipeline runner (calls Anthropic directly) ────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function callClaude(messages, system, tools, maxTokens = 4096, retries = 4) {
  const body = { model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, tools, tool_choice: { type: 'any' }, messages }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = await res.json()
      const tool = data.content?.find(b => b.type === 'tool_use')
      return { tool: tool?.name, input: tool?.input, usage: data.usage }
    }
    const errText = await res.text()
    const isOverloaded = errText.includes('overloaded') || res.status === 529 || res.status === 529
    if (isOverloaded && attempt < retries) {
      const wait = (attempt + 1) * 8000
      process.stdout.write(` [overloaded, retry in ${wait/1000}s] `)
      await sleep(wait)
      continue
    }
    throw new Error(`Anthropic error: ${errText}`)
  }
}

// Minimal planner
async function runPlanner(request, lang = 'es') {
  const { input } = await callClaude(
    [{ role: 'user', content: request }],
    `Sei il planner di un website builder. Data una richiesta, produci un piano per UNA SOLA PAGINA con sezioni essenziali.
REGOLE SLUG: usa sempre "home" per la homepage (MAI "./" o "/"), slugs senza slash né estensione (es: "precios", "contacto", "sobre-nosotros", "referencias").
Lingua del sito: ${lang}.`,
    [{
      name: 'plan', description: 'Piano pagine',
      input_schema: { type: 'object', properties: {
        businessType: { type: 'string' },
        pages: { type: 'array', items: { type: 'object', properties: {
          slug: { type: 'string' }, name: { type: 'string' }, sections: { type: 'array', items: { type: 'string' } }
        }, required: ['slug', 'name', 'sections'] } }
      }, required: ['businessType', 'pages'] }
    }], 512
  )
  // Ensure home slug is always 'home'
  if (input?.pages) input.pages = input.pages.map(p => ({ ...p, slug: p.slug === './' || p.slug === '/' ? 'home' : p.slug }))
  return input
}

// Minimal HTML generator
async function runHtml(request, plan, existingPages = [], lang = 'es') {
  const allPagesMeta = [...existingPages.map(p => ({ slug: p.slug, name: p.name })), ...plan.pages]
  const navLinks = allPagesMeta.map(p => `${p.name} → ./${p.slug === 'home' ? '' : p.slug}`).join(', ')

  const { input, usage } = await callClaude(
    [{ role: 'user', content: `Richiesta: ${request}\n\nPAGINE DA GENERARE:\n${plan.pages.map(p => `- ${p.slug}: ${p.sections.join(', ')}`).join('\n')}\n\nTUTTE LE PAGINE DEL SITO (per navbar): ${navLinks}` }],
    `Sei un esperto web designer. Genera HTML completo, mobile-first, con CSS inline, design moderno. Ogni pagina deve avere una <nav> che linka TUTTE le pagine del sito con href relativi senza .html (es: href="./" per home, href="./precios" per precios). Lingua del sito: ${lang}. Tutti i testi devono essere in ${lang === 'es' ? 'spagnolo' : lang === 'en' ? 'inglese' : lang === 'it' ? 'italiano' : lang}.`,
    [{
      name: 'create_site', description: 'Genera le pagine HTML',
      input_schema: { type: 'object', properties: {
        pages: { type: 'array', items: { type: 'object', properties: {
          slug: { type: 'string' }, name: { type: 'string' }, html: { type: 'string' }
        }, required: ['slug', 'name', 'html'] } },
        summary: { type: 'string' }
      }, required: ['pages', 'summary'] }
    }], 8192
  )
  return { pages: input.pages, summary: input.summary, usage }
}

// Sync navbar across pages (mirrors frontend syncNavigation)
function syncNavigation(pages, newSlug) {
  if (pages.length <= 1) return pages
  const newPage = pages.find(p => p.slug === newSlug)
  if (!newPage) return pages
  const navMatch = newPage.html.match(/<nav[\s\S]*?<\/nav>/i)
  if (!navMatch) return pages
  const newNav = navMatch[0]
  return pages.map(p => {
    if (p.slug === newSlug) return p
    if (!/<nav[\s\S]*?<\/nav>/i.test(p.html)) return p
    return { ...p, html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, newNav) }
  })
}

// ── TEST SCENARIOS ────────────────────────────────────────────────────────────
const STEPS = [
  { prompt: 'Fammi un sito web per Factulista, un SaaS per la fatturazione per autonomos y pyme in spagna. Software in spagnolo.', expectedAgent: 'pipeline', desc: 'Home page creation' },
  { prompt: 'Crea la pagina precios', expectedAgent: 'pipeline', desc: 'Pricing page' },
  { prompt: 'Crea la pagina contacto', expectedAgent: 'pipeline', desc: 'Contact page' },
  { prompt: 'Crea la pagina sobre nosotros', expectedAgent: 'pipeline', desc: 'About us page' },
  { prompt: 'Crea la pagina referencias con testimonios de clientes', expectedAgent: 'pipeline', desc: 'References/testimonials page' },
]

let pages = []
let contextLang = null  // persists across steps like Supabase context does in real app
const results = []

console.log('═'.repeat(70))
log(C.bold + C.cyan, ' 🤖 FACTULISTA AGENT E2E TEST')
console.log('═'.repeat(70))

for (let i = 0; i < STEPS.length; i++) {
  const step = STEPS[i]
  console.log(`\n${C.bold}STEP ${i + 1}/5: ${step.desc}${C.reset}`)
  console.log(`  Prompt: "${step.prompt}"`)

  const t0 = Date.now()

  // 1. Classify
  const agent = classify(step.prompt, pages.length > 0)
  if (agent !== step.expectedAgent) {
    err(`classify() → "${agent}" (expected "${step.expectedAgent}")`)
  } else {
    ok(`classify() → "${agent}" ✓`)
  }

  // 2. Language detection — persists in context like real app does
  const lang = detectLang(step.prompt)
  if (lang) contextLang = lang
  const effectiveLang = contextLang || 'es'
  info(`detectLanguage() → ${lang || `null (using context: ${effectiveLang})`}`)

  // 3. Planner
  let plan
  try {
    process.stdout.write('  ⏳ Planner... ')
    plan = await runPlanner(step.prompt, effectiveLang)
    console.log(`done (${Date.now() - t0}ms)`)
    ok(`Planner → ${plan.pages.map(p => p.slug).join(', ')} | business: ${plan.businessType}`)
  } catch (e) {
    err(`Planner failed: ${e.message}`)
    results.push({ step: step.desc, status: 'FAIL', error: e.message })
    continue
  }

  // 4. HTML generation
  let htmlResult
  try {
    process.stdout.write('  ⏳ HTML Agent... ')
    const t1 = Date.now()
    htmlResult = await runHtml(step.prompt, plan, pages, effectiveLang)
    console.log(`done (${Date.now() - t1}ms)`)

    // Normalise: model sometimes returns pages as a single object or string
    if (!Array.isArray(htmlResult.pages)) {
      warn(`pages is not an array (type: ${typeof htmlResult.pages}) — wrapping`)
      if (typeof htmlResult.pages === 'string') {
        // raw html string → wrap into home page
        htmlResult.pages = [{ slug: plan.pages[0]?.slug || 'home', name: plan.pages[0]?.name || 'Home', html: htmlResult.pages }]
      } else if (htmlResult.pages && typeof htmlResult.pages === 'object') {
        htmlResult.pages = [htmlResult.pages]
      } else {
        throw new Error(`Unexpected pages type: ${JSON.stringify(htmlResult.pages)?.slice(0, 100)}`)
      }
    }

    ok(`HTML Agent → ${htmlResult.pages.length} page(s) | tokens: in=${htmlResult.usage?.input_tokens} out=${htmlResult.usage?.output_tokens}`)
  } catch (e) {
    err(`HTML Agent failed: ${e.message}`)
    results.push({ step: step.desc, status: 'FAIL', error: e.message })
    continue
  }

  // 5. Merge pages
  const newSlugs = htmlResult.pages.map(p => p.slug)
  const merged = [
    ...pages.filter(p => !newSlugs.includes(p.slug)),
    ...htmlResult.pages,
  ]

  // 6. Sync navigation
  let synced = merged
  for (const slug of newSlugs) {
    synced = syncNavigation(synced, slug)
  }
  pages = synced

  // 7. Validate
  const stepResult = { step: step.desc, status: 'PASS', issues: [] }
  console.log(`\n  📊 VALIDATION (${pages.length} total pages):`)
  printPages(pages)

  // Check all pages have nav
  const noNav = pages.filter(p => !/<nav[\s\S]*?<\/nav>/i.test(p.html))
  if (noNav.length) {
    warn(`Pages missing <nav>: ${noNav.map(p => p.slug).join(', ')}`)
    stepResult.issues.push(`missing nav: ${noNav.map(p => p.slug).join(', ')}`)
  }

  // Check all pages link to all other pages
  for (const page of pages) {
    const missing = pages.filter(other => {
      if (other.slug === page.slug) return false
      const expectedHref = other.slug === 'home' ? './' : `./${other.slug}`
      return !page.html.includes(expectedHref)
    })
    if (missing.length) {
      warn(`"${page.slug}" missing links to: ${missing.map(p => p.slug).join(', ')}`)
      stepResult.issues.push(`${page.slug} missing links to ${missing.map(p => p.slug).join(', ')}`)
      stepResult.status = 'PARTIAL'
    }
  }

  // Check language (looking for Spanish keywords)
  const esWords = ['factulista', 'factura', 'precio', 'contacto', 'nosotros', 'inicio', 'home', 'inicio']
  const newPage = htmlResult.pages[0]
  const hasSpanish = esWords.some(w => newPage.html.toLowerCase().includes(w))
  if (!hasSpanish && lang === 'es') {
    warn(`"${newPage.slug}" might not be in Spanish`)
    stepResult.issues.push(`language check failed for ${newPage.slug}`)
  }

  if (stepResult.issues.length === 0) ok(`All checks passed for step ${i + 1}`)
  results.push(stepResult)

  dim(`Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

// ── FINAL REPORT ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
log(C.bold + C.cyan, ' 📋 FINAL REPORT')
console.log('═'.repeat(70))
console.log(`\n  Total pages generated: ${pages.length}`)
console.log(`  Pages: ${pages.map(p => p.slug).join(' → ')}\n`)

results.forEach((r, i) => {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'PARTIAL' ? '⚠️ ' : '❌'
  console.log(`  ${icon}  Step ${i + 1}: ${r.step} [${r.status}]`)
  if (r.issues?.length) r.issues.forEach(iss => dim(`       → ${iss}`))
  if (r.error) dim(`       → Error: ${r.error}`)
})

const pass = results.filter(r => r.status === 'PASS').length
const partial = results.filter(r => r.status === 'PARTIAL').length
const fail = results.filter(r => r.status === 'FAIL').length
console.log(`\n  Score: ${pass} PASS / ${partial} PARTIAL / ${fail} FAIL out of ${results.length}`)

// Save HTML output for manual inspection
fs.writeFileSync('/tmp/factulista-test-output.json', JSON.stringify(pages.map(p => ({
  slug: p.slug, name: p.name, htmlLength: p.html.length,
  hasNav: /<nav[\s\S]*?<\/nav>/i.test(p.html),
  links: (p.html.match(/href=["'][^"']*["']/g) || []).map(h => h.replace(/href=["']|["']/g, ''))
})), null, 2))
console.log('\n  Full page metadata saved to /tmp/factulista-test-output.json')
console.log('═'.repeat(70))
