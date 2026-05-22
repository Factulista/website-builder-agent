/**
 * Test script: simula il flusso "ispirazione URL" su un sito reale.
 * Esegue: fetchSiteHtml → extractCssFromHtml → Claude analyze → stampa DesignBrief
 *
 * Run: node scripts/test-inspiration.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// Load env
const envPath = resolve(__dir, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])
)
const API_KEY = env.ANTHROPIC_API_KEY
if (!API_KEY) { console.error('No ANTHROPIC_API_KEY'); process.exit(1) }

const URL_TO_ANALYZE = 'https://www.hotelbuonconsiglio.com/'

// ── Site fetcher ────────────────────────────────────────────────────────────
async function fetchSiteHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DesignAnalyzer/1.0)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const html = await res.text()
  return html.slice(0, 30000)
}

function extractCssFromHtml(html) {
  const styles = []
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) styles.push(m[1])
  for (const m of html.matchAll(/style="([^"]{10,200})"/gi)) styles.push(m[1])
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css[^"']*/gi)) styles.push(`/* GFont: ${m[0]} */`)
  const cssVars = html.match(/--[\w-]+:\s*[^;}{]+/g) ?? []
  styles.push(cssVars.join('\n'))
  return styles.join('\n').slice(0, 15000)
}

// ── Claude call ─────────────────────────────────────────────────────────────
const TOOLS = [{
  name: 'extract_design',
  description: 'Estrai il design system da HTML/CSS.',
  input_schema: {
    type: 'object',
    properties: {
      colors: {
        type: 'object',
        properties: {
          primary: { type: 'string' },
          secondary: { type: 'string' },
          accent: { type: 'string' },
          background: { type: 'string' },
          text: { type: 'string' },
          others: { type: 'array', items: { type: 'string' } },
        },
      },
      fonts: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string' },
          others: { type: 'array', items: { type: 'string' } },
        },
      },
      borderRadius: { type: 'string' },
      spacing: { type: 'string' },
      style: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['colors', 'fonts'],
  },
}]

async function callClaude(userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      temperature: 0,
      system: `Sei un esperto UI designer. Analizzi HTML e CSS di siti web per estrarne il design system.
Estrai colori predominanti, font, border-radius, spacing e lo stile visivo generale.
Converti sempre i colori in HEX. Se un colore è in RGB/HSL, convertilo.
Guarda prioritariamente le variabili CSS custom (--color-*, --font-*), poi i valori più ripetuti.`,
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userMessage }],
    }),
  })
  return res
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`\n🔍 Analisi sito: ${URL_TO_ANALYZE}\n`)

try {
  // Step 1: Fetch HTML
  process.stdout.write('📡 Fetching HTML... ')
  const html = await fetchSiteHtml(URL_TO_ANALYZE)
  console.log(`✅ ${html.length} chars`)

  // Step 2: Extract CSS
  process.stdout.write('🎨 Estrazione CSS... ')
  const css = extractCssFromHtml(html)
  console.log(`✅ ${css.length} chars di CSS`)

  // Step 3: Call Claude
  process.stdout.write('🤖 Analisi con Claude... ')
  const userMessage = `Analizza il design system di questo sito (${URL_TO_ANALYZE}).

CSS ESTRATTO:
${css}

HTML (prime righe per contesto):
${html.slice(0, 3000)}`

  const res = await callClaude(userMessage)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude error ${res.status}: ${err}`)
  }
  const data = await res.json()
  const toolUse = data.content?.find(b => b.type === 'tool_use')
  if (!toolUse) throw new Error('No tool_use in response')
  console.log('✅\n')

  // Print result
  const brief = toolUse.input
  console.log('═══════════════════════════════════════════════════')
  console.log('          DESIGN BRIEF — hotelbuonconsiglio.com')
  console.log('═══════════════════════════════════════════════════')
  console.log(`\n🎨 STILE:       ${brief.style ?? '—'}`)
  console.log(`\n🖌️  COLORI:`)
  console.log(`   Primary:    ${brief.colors?.primary ?? '—'}`)
  console.log(`   Secondary:  ${brief.colors?.secondary ?? '—'}`)
  console.log(`   Accent:     ${brief.colors?.accent ?? '—'}`)
  console.log(`   Background: ${brief.colors?.background ?? '—'}`)
  console.log(`   Text:       ${brief.colors?.text ?? '—'}`)
  if (brief.colors?.others?.length) console.log(`   Others:     ${brief.colors.others.join(', ')}`)
  console.log(`\n🔤 FONT:`)
  console.log(`   Heading:    ${brief.fonts?.heading ?? '—'}`)
  console.log(`   Body:       ${brief.fonts?.body ?? '—'}`)
  console.log(`\n📐 Border radius: ${brief.borderRadius ?? '—'}`)
  console.log(`📏 Spacing:       ${brief.spacing ?? '—'}`)
  if (brief.notes) console.log(`\n📝 NOTE:\n   ${brief.notes}`)
  console.log('\n═══════════════════════════════════════════════════')

  console.log('\n✅ Test Round 1 completato — design brief estratto correttamente.')
  console.log('   Prossimo step: caricare 2-3 screenshot per analisi Claude Vision (Round 2)\n')

} catch (err) {
  console.error('\n❌ Errore:', err.message)
  process.exit(1)
}
