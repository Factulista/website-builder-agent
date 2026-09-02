import { NextRequest, NextResponse } from 'next/server'
import { requireUser, requireUserAndProjectOwnership, jsonError } from '../../../lib/api-auth'
import { precheckCredits, consumeCredits } from '../../../lib/credits'
import { startRun, completeRun, failRun } from '../../../lib/agents/run-logger'

export const runtime = 'nodejs'
export const maxDuration = 120

// Simpler cousin of /api/generate-blog-post: instructional/how-to tone instead of
// SEO-blog tone, no keyword-density concerns, no streaming (articles here are shorter).
// Uses requireUserAndProjectOwnership (not requireUserAndProject) — this route never
// reads project.site_config, only needs to verify ownership. See the Supabase-load
// investigation for why that distinction matters (site_config can be several MB).
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API key mancante' }, { status: 500 })

  const body = await req.json()
  const { topic, category, wordCount = 600, projectId, context, steps } = body as {
    topic: string
    category?: string
    wordCount?: number
    projectId?: string
    context?: { businessName?: string; businessType?: string; language?: string }
    // Optional: ordered screenshots the user uploaded, each with a short caption
    // describing what happens at that step. When present, the model sees the actual
    // screenshot (vision) alongside the caption instead of guessing from text alone,
    // and is told the exact already-uploaded URL to embed for each one.
    steps?: Array<{ caption: string; imageBase64: string; mediaType: string; imageUrl: string }>
  }

  if (!topic) return NextResponse.json({ error: 'topic richiesto' }, { status: 400 })
  if (steps && steps.length > 12) return NextResponse.json({ error: 'Máximo 12 capturas por artículo' }, { status: 400 })

  let userId: string
  try {
    const authCtx = projectId
      ? await requireUserAndProjectOwnership(req, projectId)
      : await requireUser(req)
    await precheckCredits(authCtx.user.id, authCtx.supabase)
    userId = authCtx.user.id
  } catch (err) {
    return jsonError(err) as NextResponse
  }

  const runStartTime = Date.now()
  let runId = ''
  try {
    runId = await startRun({
      project_id: projectId,
      user_id: userId,
      agent_type: 'support-article',
      input_summary: topic.slice(0, 300),
      model: 'claude-sonnet-4-6',
    })
  } catch (runErr) {
    console.error('[run-logger] startRun failed:', String(runErr))
  }

  const lang = context?.language ?? 'es'
  const langLabel = lang === 'it' ? 'italiano' : lang === 'en' ? 'inglese' : lang === 'fr' ? 'francese' : lang === 'de' ? 'tedesco' : 'spagnolo'
  const businessCtx = context ? `\nContexto del producto: ${context.businessName ?? '—'} (${context.businessType ?? '—'})` : ''

  const hasSteps = Array.isArray(steps) && steps.length > 0

  const system = `Eres un redactor técnico especializado en artículos de ayuda/soporte (how-to) para software.
Escribe SIEMPRE en ${langLabel}.
Prioriza la CLARIDAD y la PRECISIÓN sobre el estilo — el lector busca resolver una tarea concreta, no leer marketing.
Responde SOLO en el formato de dos bloques descrito abajo, sin markdown ni texto extra fuera de ellos.

REGLA ABSOLUTA — HTML SEMÁNTICO PURO:
- CERO atributos style="" en cualquier etiqueta (excepto el atributo src de las <img> que se te indiquen explícitamente).
- Usa SOLO etiquetas semánticas: h1 h2 h3 p ul ol li strong em table thead tbody tr th td div img.
- Estructura preferida: <h1> título de la tarea, párrafo de respuesta directa ("Para hacer X, sigue estos pasos:"), luego <h2> por cada fase si hace falta, con los PASOS como <ol><li> numerados (no como prosa) — esto es lo más importante para un how-to.
- Si aplica, añade una sección "Requisitos previos" (<ul>) antes de los pasos.
- Cierra con una breve sección de preguntas frecuentes si tiene sentido.${businessCtx}${hasSteps ? `

REGLA PARA LAS CAPTURAS DE PANTALLA:
- Se te proporcionan ${steps!.length} capturas de pantalla en orden, cada una con una URL YA SUBIDA y una breve nota del usuario sobre qué pasa en ese paso.
- Para CADA captura, escribe el paso correspondiente en <li> basándote en lo que ves en la imagen + la nota del usuario, e inserta EXACTAMENTE la etiqueta <img src="LA_URL_EXACTA_INDICADA" alt="descripción breve y precisa de la captura"> inmediatamente después del <li> de ese paso (fuera de la lista, como elemento propio).
- No inventes URLs — usa solo las URLs que se te dan, una vez cada una, en el mismo orden.` : ''}`

  const userMessageText = `Escribe un artículo de ayuda sobre: "${topic}"
${category ? `Categoría: "${category}"` : ''}
Longitud aproximada: ${wordCount} palabras.
${hasSteps ? `\nA continuación tienes las ${steps!.length} capturas de pantalla en orden, cada una con su nota y su URL ya subida.` : ''}

FORMATO DE SALIDA — DOS BLOQUES SEPARADOS:

BLOQUE 1 — metadatos, SOLO este JSON en una línea:
{"title": "H1 claro y directo, max 70 caracteres", "slug": "slug-kebab-case", "seo_title": "max 60 caracteres", "seo_description": "meta description 120-160 caracteres", "excerpt": "resumen 1-2 frases max 200 caracteres"}

Luego, en una línea aparte, escribe EXACTAMENTE este delimitador:
===CONTENT_HTML===

Luego el HTML COMPLETO del artículo, HTML crudo (no dentro de una cadena JSON, sin escapar comillas).`

  // Build the user message content: plain text when there are no screenshots, or an
  // interleaved array of text/image blocks (Claude vision) when there are — one text
  // block per step (caption + the exact URL to use) immediately followed by that step's
  // image, so the model can see and describe each screenshot in its actual context.
  type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  const messageContent: string | ContentBlock[] = hasSteps
    ? [
        { type: 'text', text: userMessageText },
        ...steps!.flatMap((s, i): ContentBlock[] => [
          { type: 'text', text: `Paso ${i + 1}. Nota del usuario: "${s.caption || '(sin nota)'}" — URL ya subida para este paso: ${s.imageUrl}` },
          { type: 'image', source: { type: 'base64', media_type: s.mediaType || 'image/png', data: s.imageBase64 } },
        ]),
      ]
    : userMessageText

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system,
        messages: [{ role: 'user', content: messageContent }],
      }),
    })

    if (!response.ok) {
      if (runId) failRun(runId, { error_message: `API error: ${response.status}`, duration_ms: Date.now() - runStartTime }).catch(() => null)
      return NextResponse.json({ error: `API error: ${response.status}` }, { status: 502 })
    }

    const data = await response.json()
    const fullText = (data.content ?? []).map((b: { type: string; text?: string }) => b.type === 'text' ? b.text ?? '' : '').join('')
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined

    if (usage) {
      const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      if (total > 0) {
        consumeCredits(userId, total, 'support-article', projectId ?? null, {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
        }).catch((e: unknown) => console.error('[credits] consume failed (support-article):', e))
      }
    }

    const delimiterMatch = fullText.match(/===\s*CONTENT_HTML\s*===/)
    if (!delimiterMatch) throw new Error('Delimiter ===CONTENT_HTML=== not found')

    const metaPart = fullText.slice(0, delimiterMatch.index)
    const htmlPart = fullText.slice((delimiterMatch.index ?? 0) + delimiterMatch[0].length)

    const jsonMatch = metaPart.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No metadata JSON found')
    const article = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    const contentHtml = htmlPart.trim()
      .replace(/^```html\s*/i, '').replace(/```\s*$/, '')
      .replace(/\s*style="[^"]*"/gi, '')
      .replace(/\s*class=""/gi, '')
      .replace(/&quot;/g, '"')
    article.content_html = contentHtml

    if (runId) {
      completeRun(runId, {
        output_summary: (article.title as string) ?? topic,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        duration_ms: Date.now() - runStartTime,
        output_data: { tool: 'generate-support-article', summary: (article.title as string) ?? undefined },
      }).catch(() => null)
    }

    return NextResponse.json({ article })
  } catch (err) {
    if (runId) failRun(runId, { error_message: String(err).slice(0, 500), duration_ms: Date.now() - runStartTime }).catch(() => null)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
