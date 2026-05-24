import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError } from '../../../lib/api-auth'
import { precheckCredits, consumeCredits } from '../../../lib/credits'

export const runtime = 'nodejs'

type ImageMeta = {
  alt: string
  title: string
  description: string
  suggestedFilename: string
}

export async function POST(req: NextRequest) {
  try {
    // Auth + credits pre-check
    const { user, supabase } = await requireUser(req)
    await precheckCredits(user.id, supabase)

    const { imageUrl, context } = await req.json() as {
      imageUrl: string
      context?: {
        businessName?: string
        businessType?: string
        services?: string[]
        language?: string
        targetAudience?: string
      }
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl richiesto' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key mancante' }, { status: 500 })
    }

    const lang = context?.language ?? 'it'

    // Build all prompt strings in the target language to avoid model confusion
    const i18n: Record<string, Record<string, string>> = {
      system: {
        it: 'Sei un esperto SEO e accessibilità web. Analizzi immagini e generi metadati ottimizzati in ITALIANO. Rispondi SOLO con JSON valido, senza markdown o testo extra.',
        es: 'Eres un experto en SEO y accesibilidad web. Analizas imágenes y generas metadatos optimizados en ESPAÑOL. Responde SOLO con JSON válido, sin markdown ni texto adicional.',
        en: 'You are an SEO and web accessibility expert. You analyze images and generate optimized metadata in ENGLISH. Reply ONLY with valid JSON, no markdown or extra text.',
        de: 'Du bist ein SEO- und Web-Accessibility-Experte. Du analysierst Bilder und generierst optimierte Metadaten auf DEUTSCH. Antworte NUR mit gültigem JSON, kein Markdown.',
        fr: 'Tu es expert en SEO et accessibilité web. Tu analyses des images et génères des métadonnées optimisées en FRANÇAIS. Réponds UNIQUEMENT avec du JSON valide, sans markdown.',
        pt: 'És um especialista em SEO e acessibilidade web. Analisas imagens e geras metadados otimizados em PORTUGUÊS. Responde APENAS com JSON válido, sem markdown.',
      },
      contextLabel: {
        it: 'Contesto del sito',
        es: 'Contexto del sitio',
        en: 'Site context',
        de: 'Website-Kontext',
        fr: 'Contexte du site',
        pt: 'Contexto do site',
      },
      prompt: {
        it: 'Analizza questa immagine e genera i metadati SEO ottimizzati in italiano.',
        es: 'Analiza esta imagen y genera los metadatos SEO optimizados en español.',
        en: 'Analyze this image and generate optimized SEO metadata in English.',
        de: 'Analysiere dieses Bild und generiere optimierte SEO-Metadaten auf Deutsch.',
        fr: 'Analyse cette image et génère des métadonnées SEO optimisées en français.',
        pt: 'Analisa esta imagem e gera metadados SEO otimizados em português.',
      },
      altDesc: {
        it: 'testo alternativo descrittivo per accessibilità, max 125 caratteri, include keyword rilevanti per il settore',
        es: 'texto alternativo descriptivo para accesibilidad, máx 125 caracteres, incluye keywords relevantes del sector',
        en: 'descriptive alternative text for accessibility, max 125 chars, include relevant industry keywords',
        de: 'beschreibender Alternativtext für Barrierefreiheit, max 125 Zeichen, relevante Branchenkeywords',
        fr: 'texte alternatif descriptif pour l\'accessibilité, max 125 caractères, inclut les mots-clés du secteur',
        pt: 'texto alternativo descritivo para acessibilidade, máx 125 caracteres, inclui palavras-chave do setor',
      },
      titleDesc: {
        it: 'titolo breve dell\'immagine, max 60 caratteri',
        es: 'título breve de la imagen, máx 60 caracteres',
        en: 'short image title, max 60 chars',
        de: 'kurzer Bildtitel, max 60 Zeichen',
        fr: 'titre court de l\'image, max 60 caractères',
        pt: 'título curto da imagem, máx 60 caracteres',
      },
      descDesc: {
        it: 'descrizione estesa, max 200 caratteri',
        es: 'descripción extendida, máx 200 caracteres',
        en: 'extended description, max 200 chars',
        de: 'erweiterte Beschreibung, max 200 Zeichen',
        fr: 'description étendue, max 200 caractères',
        pt: 'descrição alargada, máx 200 caracteres',
      },
    }
    const L = (key: string) => (i18n[key] as Record<string,string>)[lang] ?? (i18n[key] as Record<string,string>)['it']

    const contextBlock = context
      ? `\n${L('contextLabel')}: ${context.businessName ?? ''} — ${context.businessType ?? ''} — ${context.services?.join(', ') ?? ''}`
      : ''

    const system = L('system')

    const userMessage = `${L('prompt')}${contextBlock}

{
  "alt": "${L('altDesc')}",
  "title": "${L('titleDesc')}",
  "description": "${L('descDesc')}",
  "suggestedFilename": "seo-friendly-filename-no-extension-lowercase-hyphens"
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: imageUrl },
              },
              {
                type: 'text',
                text: userMessage,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('generate-image-meta: Claude error', res.status, err)
      return NextResponse.json({ error: 'Errore AI' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''

    // Consume credits (fire-and-forget)
    const inputT = Number(data.usage?.input_tokens ?? 0)
    const outputT = Number(data.usage?.output_tokens ?? 0)
    const totalT = inputT + outputT
    if (totalT > 0) {
      consumeCredits(user.id, totalT, 'image-meta', null, { input: inputT, output: outputT }, supabase)
        .catch((e: unknown) => console.error('[credits] image-meta consume failed:', e))
    }

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Risposta AI non valida' }, { status: 500 })
    }

    const meta: ImageMeta = JSON.parse(jsonMatch[0])

    return NextResponse.json(meta)
  } catch (error) {
    return jsonError(error)
  }
}
