import { fetchWithRetry } from './fetch-retry'
import { AnthropicBillingError } from '../credits'

/** Detect Anthropic billing-out-of-credits error from a non-ok response body. */
async function detectBillingError(res: Response): Promise<void> {
  if (res.status !== 400 && res.status !== 402) return
  const body = await res.clone().text().catch(() => '')
  if (body.includes('credit balance is too low') || body.includes('Your credit balance')) {
    throw new AnthropicBillingError()
  }
}

export type AgentConfig = {
  model: string
  maxTokens: number
  temperature?: number
  description: string
}

// Module-level cache for DB overrides — populated at request time via applyDbOverrides()
let _dbOverrides: Record<string, { model?: string; maxTokens?: number }> = {}

export function applyDbOverrides(
  configs: Array<{ name: string; model: string; max_tokens: number }>
): void {
  _dbOverrides = {}
  for (const c of configs) {
    _dbOverrides[c.name] = { model: c.model, maxTokens: c.max_tokens }
  }
}

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  orchestrator: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    temperature: 0,
    description: 'Classifica intent e coordina il pipeline',
  },
  planner: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    temperature: 0.2,
    description: 'Pianifica struttura pagine e sezioni',
  },
  content: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    temperature: 0.7,
    description: 'Genera testi, copy e Schema.org',
  },
  design: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    temperature: 0.5,
    description: 'Genera palette colori, font e CSS',
  },
  html: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 32768,
    temperature: 0.2,
    description: 'Genera e modifica HTML delle pagine',
  },
  seo: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    temperature: 0.1,
    description: 'Ottimizza meta tag, sitemap e robots.txt',
  },
  images: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    temperature: 0.1,
    description: 'Ottimizza alt text, srcset e lazy loading',
  },
  accessibility: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    temperature: 0,
    description: 'Valida e corregge WCAG 2.1 AA',
  },
  memory: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    temperature: 0,
    description: 'Estrae e aggiorna il contesto del progetto',
  },
}

export async function callClaude(
  agentName: string,
  system: string,
  messages: { role: string; content: string }[],
  tools: object[],
  apiKey: string,
  maxRetries = 3
): Promise<Response> {
  const base = AGENT_CONFIGS[agentName] ?? AGENT_CONFIGS.html
  const override = _dbOverrides[agentName] ?? {}
  const config = { ...base, ...override }

  // Prompt Caching: separa system in parte statica (cacheable) e dinamica
  // La parte statica è tutto ciò che precede "PIANO DEL SITO:" o "PAGINE ATTUALI:" o simili
  const dynamicMarkers = ['PIANO DEL SITO:', 'PAGINE ATTUALI:', 'PAGINE DEL SITO:', 'URL BASE:']
  const dynamicIdx = dynamicMarkers.reduce((min, marker) => {
    const idx = system.indexOf(marker)
    return idx > -1 && idx < min ? idx : min
  }, system.length)

  const staticPart = system.slice(0, dynamicIdx).trim()
  const dynamicPart = system.slice(dynamicIdx).trim()

  const systemBlocks = staticPart.length >= 100
    ? [
        { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
        ...(dynamicPart ? [{ type: 'text', text: dynamicPart }] : []),
      ]
    : system // fallback stringa se troppo corto per la cache

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        system: systemBlocks,
        ...(tools.length > 0 && { tools, tool_choice: { type: 'any' } }),
        messages,
      }),
    }, agentName)

    if (res.ok) return res

    // Retry on overload or server errors — check status only, never read body
    const isRetryable = res.status === 529 || res.status === 500 || res.status === 503
    if (isRetryable && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    // Detect billing error before returning the raw response to callers
    await detectBillingError(res)
    return res
  }

  return new Response(JSON.stringify({ error: 'Max retries exceeded' }), { status: 503 })
}

// Content block types for multimodal messages
export type ImageBlock = {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
}
export type TextBlock = { type: 'text'; text: string }
export type ContentBlock = ImageBlock | TextBlock

/** callClaudeMultimodal — like callClaude but supports image content blocks in messages.
 *  Used by the site-analyzer (Claude Vision) to analyze screenshots. */
export async function callClaudeMultimodal(
  model: string,
  system: string,
  content: ContentBlock[],
  tools: object[],
  apiKey: string,
  maxRetries = 2
): Promise<Response> {
  const messages = [{ role: 'user', content }]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system,
        ...(tools.length > 0 && { tools, tool_choice: { type: 'any' } }),
        messages,
      }),
    })

    if (res.ok) return res

    const isRetryable = res.status === 529 || res.status === 500 || res.status === 503
    if (isRetryable && attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500
      await new Promise(r => setTimeout(r, delay))
      continue
    }

    await detectBillingError(res)
    return res
  }

  return new Response(JSON.stringify({ error: 'Max retries exceeded' }), { status: 503 })
}
