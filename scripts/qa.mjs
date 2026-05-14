/**
 * QA end-to-end test — run with: npm run qa
 * Tests the full pipeline before pushing to avoid breaking prod.
 * Costs ~1 pipeline call worth of tokens — much cheaper than chasing bugs in prod.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load .env.local manually (Next.js doesn't load it for plain node scripts)
function loadEnv() {
  const envPath = resolve(root, '.env.local')
  try {
    const lines = readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    console.error('⚠️  .env.local not found — make sure ANTHROPIC_API_KEY is set')
  }
}

loadEnv()

const API_KEY = process.env.ANTHROPIC_API_KEY
if (!API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY missing')
  process.exit(1)
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const HAIKU = 'claude-haiku-4-5-20251001'

// ─── helpers ────────────────────────────────────────────────────────────────

function pass(label) { console.log(`  ✅ ${label}`) }
function fail(label, reason) { console.error(`  ❌ ${label}: ${reason}`); return false }

async function callClaude({ system, userMessage, tools, maxTokens = 4096 }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: maxTokens,
        system,
        tools,
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    const isRetryable = res.status === 529 || res.status === 500 || res.status === 503
    if (isRetryable && attempt < 2) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1500))
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    const data = await res.json()
    if (data.stop_reason === 'max_tokens') throw new Error('Response truncated (max_tokens)')

    const toolUse = data.content?.find(b => b.type === 'tool_use')
    if (!toolUse) throw new Error(`No tool_use in response. stop_reason=${data.stop_reason}`)
    return toolUse.input
  }
  throw new Error('Max retries exceeded')
}

// ─── individual agent tests ──────────────────────────────────────────────────

async function testContentAgent() {
  const input = await callClaude({
    system: 'Sei un copywriter esperto. Genera contenuti per siti web.',
    userMessage: 'Crea contenuti per un sito semplice per un bar a Milano chiamato "Bar Roma".',
    tools: [{
      name: 'generate_content',
      description: 'Genera contenuti per le pagine del sito.',
      input_schema: {
        type: 'object',
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                title: { type: 'string' },
                h1: { type: 'string' },
                sections: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, headline: { type: 'string' } }, required: ['type'] } },
              },
              required: ['slug', 'title', 'h1', 'sections'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['pages', 'summary'],
      },
    }],
    maxTokens: 2048,
  })

  if (!input.pages?.length) return fail('Content agent', 'pages array is empty or missing')
  if (!input.pages[0].title) return fail('Content agent', 'first page missing title')
  if (!input.pages[0].h1) return fail('Content agent', 'first page missing h1')
  pass(`Content agent → ${input.pages.length} page(s), h1: "${input.pages[0].h1}"`)
  return true
}

async function testDesignAgent() {
  const input = await callClaude({
    system: 'Sei un UI designer esperto. Crei design system per siti web.',
    userMessage: 'Crea un design per un bar moderno a Milano.',
    tools: [{
      name: 'generate_design',
      description: 'Genera design tokens e CSS per il sito.',
      input_schema: {
        type: 'object',
        properties: {
          tokens: {
            type: 'object',
            properties: {
              colors: {
                type: 'object',
                properties: {
                  primary: { type: 'string' },
                  background: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['primary', 'background', 'text'],
              },
              fonts: {
                type: 'object',
                properties: { heading: { type: 'string' }, body: { type: 'string' } },
                required: ['heading', 'body'],
              },
            },
            required: ['colors', 'fonts'],
          },
          css: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['tokens', 'css', 'summary'],
      },
    }],
    maxTokens: 4096,
  })

  if (!input.tokens?.colors?.primary) return fail('Design agent', 'tokens.colors.primary missing')
  if (!input.tokens?.fonts?.heading) return fail('Design agent', 'tokens.fonts.heading missing')
  if (!input.css) return fail('Design agent', 'css is empty')
  pass(`Design agent → primary: ${input.tokens.colors.primary}, font: ${input.tokens.fonts.heading}`)
  return true
}

async function testHtmlAgent() {
  const input = await callClaude({
    system: 'Sei un web developer. Genera HTML completo per pagine web.',
    userMessage: 'Genera una pagina home HTML per "Bar Roma" a Milano. Includi header, hero e footer.',
    tools: [{
      name: 'create_site',
      description: 'Genera le pagine HTML del sito.',
      input_schema: {
        type: 'object',
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
    }],
    maxTokens: 8192,
  })

  if (!input.pages?.length) return fail('HTML agent', 'pages array is empty or missing')
  const page = input.pages[0]
  if (!page.html) return fail('HTML agent', 'html is empty')
  if (!page.html.includes('</html>')) return fail('HTML agent', 'html appears truncated (no </html>)')
  pass(`HTML agent → ${input.pages.length} page(s), html: ${page.html.length} chars`)
  return true
}

async function testPlannerAgent() {
  const input = await callClaude({
    system: 'Sei un product strategist. Pianifichi la struttura di siti web.',
    userMessage: 'Pianifica le pagine per un sito di un bar a Milano.',
    tools: [{
      name: 'create_plan',
      description: 'Crea un piano strutturale del sito.',
      input_schema: {
        type: 'object',
        properties: {
          businessType: { type: 'string' },
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                name: { type: 'string' },
                sections: { type: 'array', items: { type: 'string' } },
              },
              required: ['slug', 'name', 'sections'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['businessType', 'pages', 'summary'],
      },
    }],
    maxTokens: 2048,
  })

  if (!input.pages?.length) return fail('Planner agent', 'pages array is empty')
  if (!input.businessType) return fail('Planner agent', 'businessType missing')
  pass(`Planner agent → ${input.pages.length} pages, business: "${input.businessType}"`)
  return true
}

async function testSeoAgent() {
  const input = await callClaude({
    system: 'Sei un esperto SEO. Ottimizzi siti web per i motori di ricerca.',
    userMessage: 'Ottimizza SEO per il sito di un bar a Milano.',
    tools: [{
      name: 'update_seo',
      description: 'Aggiorna i meta tag SEO.',
      input_schema: {
        type: 'object',
        properties: {
          pages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pageSlug: { type: 'string' },
                edits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { find: { type: 'string' }, replace: { type: 'string' } },
                    required: ['find', 'replace'],
                  },
                },
              },
              required: ['pageSlug', 'edits'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['pages', 'summary'],
      },
    }],
    maxTokens: 2048,
  })

  if (!input.pages?.length) return fail('SEO agent', 'pages array is empty')
  pass(`SEO agent → ${input.pages.length} page(s) optimized`)
  return true
}

// ─── main ────────────────────────────────────────────────────────────────────

const TESTS = [
  { name: 'Planner Agent', fn: testPlannerAgent },
  { name: 'Content Agent', fn: testContentAgent },
  { name: 'Design Agent',  fn: testDesignAgent },
  { name: 'HTML Agent',    fn: testHtmlAgent },
  { name: 'SEO Agent',     fn: testSeoAgent },
]

async function main() {
  console.log('\n🧪 Factulista QA — pipeline end-to-end test\n')

  let passed = 0
  let failed = 0

  for (const { name, fn } of TESTS) {
    process.stdout.write(`\n[${name}]\n`)
    try {
      const ok = await fn()
      if (ok !== false) passed++
      else failed++
    } catch (err) {
      fail(name, err.message)
      failed++
    }
  }

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Result: ${passed}/${TESTS.length} passed${failed > 0 ? `, ${failed} FAILED` : ''}`)
  console.log(failed === 0 ? '✅ All good — safe to push\n' : '❌ Fix issues before pushing\n')
  process.exit(failed > 0 ? 1 : 0)
}

main()
