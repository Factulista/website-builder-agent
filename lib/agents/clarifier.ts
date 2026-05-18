import type { ProjectContext } from './memory-agent'

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
        description: 'Se proceed=false: domande da fare all\'utente, tono amichevole, in italiano. Se proceed=true: lascia vuoto.',
      },
    },
    required: ['proceed'],
  },
}

export async function runClarifier(
  userRequest: string,
  existingPages: { slug: string; name: string }[],
  context: ProjectContext,
  apiKey: string
): Promise<ClarifierResult> {
  const isFirstRun = existingPages.length === 0
  const { design: _design, ...contextWithoutDesign } = context
  const contextSummary = Object.entries(contextWithoutDesign)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const system = `Sei il quality controller di un website builder AI. Prima di generare il sito, verifica che la richiesta sia sufficientemente chiara per produrre un buon risultato.

STATO ATTUALE:
- Prima run (nessuna pagina): ${isFirstRun ? 'SÌ' : 'NO'}
- Contesto progetto già noto:
${contextSummary || '(nessuno)'}
- Pagine esistenti: ${existingPages.length > 0 ? existingPages.map(p => p.slug).join(', ') : 'nessuna'}

QUANDO CHIEDERE CHIARIMENTI (SOLO in questi casi specifici):
1. Prima run E il tipo/settore del business è completamente assente o ambiguo (es: "fammi un sito" senza nessun dettaglio sul business)
2. Prima run E la lingua non è specificata né deducibile dal testo (es: l'utente scrive in italiano ma non dice in che lingua vuole il sito — se scrive in un'altra lingua, quella È la lingua del sito)

QUANDO PROCEDERE SEMPRE (non chiedere):
- Esistono già pagine nel sito → il contesto è noto, procedi
- La lingua è già nel contesto del progetto
- L'utente scrive in una lingua diversa dall'italiano → quella è la lingua del sito
- La richiesta menziona il settore, il nome o il pubblico del business
- Si tratta di aggiungere una pagina specifica (es: "crea la pagina pricing")
- Qualsiasi dubbio non critico → procedi, è meglio generare qualcosa che bloccarsi

Se fai domande: max 2 domande, sintetiche, tono amichevole, in italiano. Non fare domande su cose che puoi dedurre.`

  try {
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
        tools: [CLARIFIER_TOOL],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userRequest }],
      }),
    })

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
