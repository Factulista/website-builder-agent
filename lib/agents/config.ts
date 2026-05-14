export type AgentConfig = {
  model: string
  maxTokens: number
  temperature?: number
  description: string
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
    maxTokens: 16384,
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
  const config = AGENT_CONFIGS[agentName] ?? AGENT_CONFIGS.html

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        ...(config.temperature !== undefined && { temperature: config.temperature }),
        system,
        tools,
        tool_choice: { type: 'any' },
        messages,
      }),
    })

    if (res.ok) return res

    // Retry on overload or server errors
    if (attempt < maxRetries) {
      const data = await res.json().catch(() => ({}))
      const isRetryable = res.status === 529 || res.status === 500 || res.status === 503 ||
        (data as { error?: { type?: string } })?.error?.type === 'overloaded_error'

      if (isRetryable) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500
        await new Promise(r => setTimeout(r, delay))
        continue
      }
    }

    return res
  }

  return new Response(JSON.stringify({ error: 'Max retries exceeded' }), { status: 503 })
}
