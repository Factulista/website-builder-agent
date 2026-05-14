import { NextRequest } from 'next/server'
import { classify } from '../../../lib/agents/orchestrator'
import { runHtmlAgent } from '../../../lib/agents/html-agent'
import { runSeoAgent } from '../../../lib/agents/seo-agent'

export const runtime = 'nodejs'
export const maxDuration = 60

type Page = { slug: string; name: string; html: string }

export async function POST(req: NextRequest) {
  try {
    const { messages, pages, activePageSlug, customDomain } = await req.json() as {
      messages: { role: string; content: string }[]
      pages: Page[]
      activePageSlug: string | null
      customDomain?: string | null
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
    const agent = classify(lastUserMessage)

    if (agent === 'seo') {
      const result = await runSeoAgent(messages, pages ?? [], customDomain ?? null, apiKey)
      return Response.json({ ...result, agent: 'seo' })
    }

    // Default: HTML agent
    const result = await runHtmlAgent(messages, pages ?? [], activePageSlug, apiKey)
    return Response.json({ ...result, agent: 'html' })

  } catch (err) {
    console.error('Chat API error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
