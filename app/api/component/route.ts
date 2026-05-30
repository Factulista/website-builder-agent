import { NextRequest } from 'next/server'
import { runComponentAgent, extractComponentStyle } from '../../../lib/agents/component-agent'
import { requireUserAndProject } from '../../../lib/api-auth'
import { precheckCredits, consumeCredits } from '../../../lib/credits'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { projectId, message, designTokensCss, imageBase64 } = await req.json() as {
      projectId: string
      message: string
      designTokensCss?: string
      imageBase64?: { data: string; media_type: string }
    }

    if (!message?.trim()) {
      return Response.json({ error: 'Messaggio richiesto' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return Response.json({ error: 'API key non configurata' }, { status: 500 })

    const { user, supabase, project } = await requireUserAndProject(req, projectId)
    await precheckCredits(user.id, supabase)

    const siteConfig = (project?.site_config ?? {}) as Record<string, unknown>
    const context = (siteConfig.context ?? {}) as Record<string, unknown>

    // ── Style memory: read previous component style from project context ──────
    // This gives the agent style continuity — new components keep the same
    // visual language (border-radius, padding, typography scale, shadow depth)
    // as the ones already generated in this project's canvas.
    const previousComponentStyle = (context.canvasComponentStyle as string | undefined) ?? undefined

    const result = await runComponentAgent(
      message,
      designTokensCss ?? '',
      apiKey,
      context,
      imageBase64,
      previousComponentStyle
    )

    // ── Consume credits non-blocking ─────────────────────────────────────────
    const usage = result.usage as { input_tokens?: number; output_tokens?: number } | undefined
    const totalTok = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    if (totalTok > 0) {
      consumeCredits(user.id, totalTok, 'chat', projectId, {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        cache_read: 0,
        model: imageBase64 ? 'claude-sonnet-4-5-20250929' : 'claude-haiku-4-5-20251001',
      }, supabase).catch((e: unknown) => console.error('[component] credits error:', e))
    }

    // ── Style memory: save generated component style to project context ───────
    // Extract the <style> block from the generated component and persist it.
    // Next time the user generates a component, the agent will reference this
    // style to maintain visual consistency across all components of the project.
    const newComponentStyle = extractComponentStyle(result.html)
    if (newComponentStyle) {
      // Fire-and-forget — don't block the response
      const { data: fresh } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
      const freshConfig = (fresh?.site_config as Record<string, unknown>) ?? siteConfig
      const freshContext = (freshConfig.context as Record<string, unknown>) ?? {}
      void supabase.from('projects').update({
        site_config: {
          ...freshConfig,
          context: { ...freshContext, canvasComponentStyle: newComponentStyle },
        },
      }).eq('id', projectId)
    }

    return Response.json({
      html: result.html,
      summary: result.summary,
      hasStyleMemory: !!previousComponentStyle,
    })
  } catch (err) {
    console.error('[component-agent] error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
