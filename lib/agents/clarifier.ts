import { fetchWithRetry } from './fetch-retry'
import type { ProjectContext } from './memory-agent'
import { langName } from './detect-lang'

export type ClarifierResult =
  | { proceed: true }
  | { proceed: false; message: string }

const CLARIFIER_TOOL = {
  name: 'decision',
  description: 'Decide se procedere con la generazione del sito o chiedere chiarimenti.',
  input_schema: {
    type: 'object' as const,
    properties: {
      proceed: {
        type: 'boolean',
        description: 'true = ho abbastanza info per procedere, false = ho bisogno di chiarimenti',
      },
      message: {
        type: 'string',
        description: 'If proceed=false: questions for the user, friendly tone. MUST be written in the DETECTED_LANG placeholder language. If proceed=true: leave empty.',
      },
    },
    required: ['proceed'],
  },
}

type AgentType = 'pipeline' | 'html' | 'design-update' | 'content-update' | 'seo' | 'images'

const AGENT_CLARIFICATION_RULES: Record<AgentType, string> = {
  pipeline: `QUANDO CHIEDERE (SOLO questi casi):
1. Prima run E business type completamente assente/ambiguo (es: "fammi un sito" senza dettagli)
2. Prima run E lingua non specificata né deducibile (se scrive in un'altra lingua → quella è la lingua)
PROCEDI SEMPRE SE: pagine esistenti, lingua nel contesto, richiesta menziona settore/nome, aggiunta pagina specifica`,

  html: `QUANDO CHIEDERE (SOLO se richiesta totalmente vuota di contenuto):
- "modifica il sito", "miglioralo", "aggiustalo" senza NESSUN dettaglio su cosa cambiare
PROCEDI SEMPRE SE: qualsiasi indicazione su cosa modificare (colore, testo, sezione, layout, ecc.)`,

  'design-update': `QUANDO CHIEDERE (SOLO se non c'è assolutamente nessun indirizzo stilistico):
- "cambia il design" o "restyle" senza specificare nulla (colore, stile, mood, ecc.)
PROCEDI SEMPRE SE: qualsiasi preferenza di stile, colore, font, mood, settore, brand`,

  'content-update': `QUANDO CHIEDERE (SOLO se manca sia la lingua che il tono):
- "aggiorna i testi" senza lingua né tono di voce
PROCEDI SEMPRE SE: lingua specificata, tono specificato, settore deducibile dal contesto`,

  seo: `PROCEDI SEMPRE. Le ottimizzazioni SEO standard non richiedono chiarimenti.`,
  images: `PROCEDI SEMPRE. Le ottimizzazioni immagini non richiedono chiarimenti.`,
}

export async function runClarifier(
  userRequest: string,
  existingPages: { slug: string; name: string }[],
  context: ProjectContext,
  apiKey: string,
  agentType: AgentType = 'pipeline',
  userLang = 'it'
): Promise<ClarifierResult> {
  // SEO e images: procedi sempre senza chiamata LLM
  if (agentType === 'seo' || agentType === 'images') return { proceed: true }

  const isFirstRun = existingPages.length === 0
  const { design: _design, ...contextWithoutDesign } = context
  const contextSummary = Object.entries(contextWithoutDesign)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const agentRules = AGENT_CLARIFICATION_RULES[agentType]

  const system = `Sei il quality controller di un website builder AI. L'agente che sta per girare è: **${agentType}**.
Verifica se la richiesta è abbastanza chiara per quell'agente, oppure se mancano info critiche.

STATO ATTUALE:
- Prima run (nessuna pagina): ${isFirstRun ? 'SÌ' : 'NO'}
- Contesto progetto:
${contextSummary || '(nessuno)'}
- Pagine esistenti: ${existingPages.length > 0 ? existingPages.map(p => p.slug).join(', ') : 'nessuna'}

REGOLE PER AGENTE "${agentType}":
${agentRules}

REGOLA GLOBALE: in caso di dubbio → procedi. È meglio generare qualcosa che bloccarsi.
LINGUA OBBLIGATORIA: l'utente sta scrivendo in **${langName(userLang)}**. Il campo \`message\` DEVE essere scritto in ${langName(userLang)} — non cambiare lingua anche se il contesto del sito è diverso.`

  try {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system,
        tools: [{
          ...CLARIFIER_TOOL,
          input_schema: {
            ...CLARIFIER_TOOL.input_schema,
            properties: {
              ...CLARIFIER_TOOL.input_schema.properties,
              message: {
                type: 'string' as const,
                description: `If proceed=false: questions for the user, friendly tone. MUST be written in ${langName(userLang)}. If proceed=true: leave empty.`,
              },
            },
          },
        }],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userRequest }],
      }),
    }, 'clarifier')

    if (!res.ok) return { proceed: true }

    const data = await res.json()
    const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
    if (!toolUse) return { proceed: true }

    const { proceed, message } = toolUse.input as { proceed: boolean; message?: string }
    if (proceed || !message) return { proceed: true }
    return { proceed: false, message }
  } catch {
    return { proceed: true } // on any error, always proceed
  }
}
