/**
 * qa-push: QA → auto-fix loop → git push
 *
 * Usage: npm run qa-push
 *
 * 1. Runs QA tests
 * 2. On failure: sends error + source files to Claude, which fixes the code
 * 3. Re-runs QA
 * 4. Repeats up to MAX_ITERATIONS
 * 5. On success: git commit + push
 */

import { execSync, spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const MAX_ITERATIONS = 3

// ─── env ────────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const lines = readFileSync(resolve(ROOT, '.env.local'), 'utf-8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) process.env[key] = val
    }
  } catch { /* .env.local optional */ }
}

loadEnv()

const API_KEY = process.env.ANTHROPIC_API_KEY
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY missing'); process.exit(1) }

// ─── files Claude can read/edit ──────────────────────────────────────────────

const AGENT_FILES = [
  'lib/agents/config.ts',
  'lib/agents/orchestrator.ts',
  'lib/agents/content-agent.ts',
  'lib/agents/design-agent.ts',
  'lib/agents/html-agent.ts',
  'lib/agents/planner.ts',
  'lib/agents/seo-agent.ts',
  'lib/agents/memory-agent.ts',
  'app/api/chat/route.ts',
]

// ─── QA runner ──────────────────────────────────────────────────────────────

function runQA() {
  const result = spawnSync('node', ['scripts/qa.mjs'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 120_000,
  })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const passed = result.status === 0
  return { passed, output }
}

// ─── Anthropic agentic call (raw fetch, no SDK needed) ───────────────────────

async function callAnthropic(messages, tools) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are a senior TypeScript developer working on a Next.js website-builder SaaS.
A QA script tests the AI agent pipeline. When tests fail you must fix the source code.
Be surgical: only change what needs fixing. Never change working code.
When done, call the done tool with a brief summary of what you fixed.`,
      tools,
      messages,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`)
  return await res.json()
}

// ─── fixer tools ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a project source file by path (relative to project root).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path, e.g. lib/agents/config.ts' } },
      required: ['path'],
    },
  },
  {
    name: 'apply_edit',
    description: 'Apply a targeted find/replace to a file. old_string must be an exact unique substring.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'Exact string to replace (must be unique in the file).' },
        new_string: { type: 'string', description: 'Replacement string.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'write_file',
    description: 'Overwrite an entire file. Use only when apply_edit is insufficient.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'done',
    description: 'Signal that all fixes have been applied and QA should be re-run.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One-line description of what was fixed.' } },
      required: ['summary'],
    },
  },
]

function handleTool(name, input) {
  const abs = (p) => resolve(ROOT, p)
  if (name === 'read_file') {
    try { return readFileSync(abs(input.path), 'utf-8') }
    catch { return `ERROR: file not found: ${input.path}` }
  }
  if (name === 'apply_edit') {
    try {
      const content = readFileSync(abs(input.path), 'utf-8')
      if (!content.includes(input.old_string)) return `ERROR: old_string not found in ${input.path}`
      writeFileSync(abs(input.path), content.replace(input.old_string, input.new_string), 'utf-8')
      return `✓ Edit applied to ${input.path}`
    } catch (e) { return `ERROR: ${e.message}` }
  }
  if (name === 'write_file') {
    try {
      writeFileSync(abs(input.path), input.content, 'utf-8')
      return `✓ File written: ${input.path}`
    } catch (e) { return `ERROR: ${e.message}` }
  }
  return 'Unknown tool'
}

// ─── fixer agent loop ─────────────────────────────────────────────────────────

async function fixWithClaude(qaOutput, iteration) {
  console.log(`\n🤖 Claude fixer (iteration ${iteration}) analyzing error...`)

  // Inline key files directly in the initial prompt to save a round-trip
  const fileSnippets = AGENT_FILES.map(f => {
    try {
      const content = readFileSync(resolve(ROOT, f), 'utf-8')
      return `\`\`\`typescript\n// ${f}\n${content}\n\`\`\``
    } catch { return null }
  }).filter(Boolean).join('\n\n')

  const messages = [{
    role: 'user',
    content: `QA failed on iteration ${iteration}. Error output:\n\n\`\`\`\n${qaOutput}\n\`\`\`\n\nCurrent source files:\n\n${fileSnippets}\n\nAnalyze the failure, fix the code, then call done(). ALL agents (Planner, Content, Design, HTML, SEO) must pass QA after your fix.`,
  }]

  let fixSummary = null
  const modifiedFiles = []

  // Agentic loop: Claude calls tools until it calls done()
  for (let step = 0; step < 20; step++) {
    const response = await callAnthropic(messages, TOOLS)
    messages.push({ role: 'assistant', content: response.content })

    const toolUses = response.content.filter(b => b.type === 'tool_use')
    if (!toolUses.length) break

    const toolResults = []
    for (const tu of toolUses) {
      if (tu.name === 'done') {
        fixSummary = tu.input.summary
        console.log(`  🔧 Fix: ${fixSummary}`)
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Done acknowledged.' })
        continue
      }
      const result = handleTool(tu.name, tu.input)
      if ((tu.name === 'apply_edit' || tu.name === 'write_file') && tu.input?.path) {
        modifiedFiles.push(tu.input.path)
      }
      console.log(`  ${tu.name}(${tu.input.path ?? ''}) → ${result.slice(0, 60)}`)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
    }

    messages.push({ role: 'user', content: toolResults })
    if (fixSummary !== null) break
    if (response.stop_reason === 'end_turn') break
  }

  if (modifiedFiles.length > 0) {
    console.log(`  📝 Modified: ${[...new Set(modifiedFiles)].join(', ')}`)
  }

  return fixSummary ?? 'auto-fix applied'
}

// ─── git push ────────────────────────────────────────────────────────────────

function gitCommitAndPush(message) {
  execSync('git add -A', { cwd: ROOT, stdio: 'inherit' })
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: ROOT, stdio: 'inherit' })
  execSync('git push', { cwd: ROOT, stdio: 'inherit' })
}

// ─── main loop ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 qa-push: test → fix → push loop\n')

  let lastFix = null

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    console.log(`\n[QA run ${i}/${MAX_ITERATIONS}]`)
    const { passed, output } = runQA()
    if (!passed) console.error(output)
    else process.stdout.write(output)

    if (passed) {
      console.log('\n✅ QA passed!')
      const msg = lastFix
        ? `qa-push: auto-fix + QA passed after ${i - 1} iteration(s)\n\n${lastFix}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
        : `qa-push: QA passed — no fixes needed\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

      try {
        gitCommitAndPush(msg)
        console.log('🚀 Pushed to origin.\n')
      } catch (e) {
        // Nothing to commit is fine
        if (e.message.includes('nothing to commit')) {
          execSync('git push', { cwd: ROOT, stdio: 'inherit' })
          console.log('🚀 Pushed to origin (no new commits).\n')
        } else {
          throw e
        }
      }
      return
    }

    if (i === MAX_ITERATIONS) {
      console.error(`\n❌ QA failed after ${MAX_ITERATIONS} auto-fix attempts. Last error:\n`)
      console.error(output.split('\n').slice(-15).join('\n'))
      console.error('\n💬 Manual intervention needed. Check the error above and fix the code.\n')
      process.exit(1)
    }

    lastFix = await fixWithClaude(output, i)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
