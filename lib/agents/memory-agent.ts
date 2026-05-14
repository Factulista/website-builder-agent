import { callClaude } from './config'

export type ProjectContext = {
  businessName?: string
  businessType?: string
  location?: string
  targetAudience?: string
  toneOfVoice?: string
  brandColors?: string[]
  brandFonts?: string[]
  uniqueValue?: string
  services?: string[]
  contactInfo?: { phone?: string; email?: string; address?: string }
  updatedAt?: string
}

const MEMORY_TOOLS = [
  {
    name: 'update_context',
    description: 'Aggiorna il contesto del progetto con le informazioni estratte dalla conversazione.',
    input_schema: {
      type: 'object' as const,
      properties: {
        businessName: { type: 'string' },
        businessType: { type: 'string', description: 'Es: ristorante, studio legale, e-commerce, agenzia web...' },
        location: { type: 'string' },
        targetAudience: { type: 'string' },
        toneOfVoice: { type: 'string', description: 'Es: formale, amichevole, tecnico, luxury...' },
        brandColors: { type: 'array', items: { type: 'string' }, description: 'Colori HEX o nomi.' },
        brandFonts: { type: 'array', items: { type: 'string' } },
        uniqueValue: { type: 'string', description: 'Proposta di valore unica del business.' },
        services: { type: 'array', items: { type: 'string' } },
        contactInfo: {
          type: 'object',
          properties: {
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
          },
        },
      },
    },
  },
]

export async function runMemoryAgent(
  messages: { role: string; content: string }[],
  currentContext: ProjectContext,
  apiKey: string
): Promise<ProjectContext | null> {
  const system = `Sei un agente di memoria. Estrai informazioni sul business dell'utente dalla conversazione e aggiorna il contesto del progetto.

CONTESTO ATTUALE:
${JSON.stringify(currentContext, null, 2)}

REGOLE:
- Estrai solo informazioni esplicitamente menzionate dall'utente.
- Non inventare o dedurre informazioni non dette.
- Aggiorna solo i campi dove hai nuove informazioni.
- Se non ci sono nuove informazioni, chiama update_context con un oggetto vuoto {}.`

  const res = await callClaude('memory', system, messages, MEMORY_TOOLS, apiKey)
  if (!res.ok) return null

  const data = await res.json()
  const toolUse = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!toolUse) return null

  const extracted = toolUse.input as Partial<ProjectContext>
  const hasNewInfo = Object.keys(extracted).length > 0

  if (!hasNewInfo) return null

  return {
    ...currentContext,
    ...extracted,
    updatedAt: new Date().toISOString(),
  }
}

export function buildContextPrompt(context: ProjectContext): string {
  if (!context || Object.keys(context).length === 0) return ''

  const parts: string[] = ['## CONTESTO PROGETTO (usa sempre queste informazioni):']
  if (context.businessName) parts.push(`- Nome: ${context.businessName}`)
  if (context.businessType) parts.push(`- Settore: ${context.businessType}`)
  if (context.location) parts.push(`- Location: ${context.location}`)
  if (context.targetAudience) parts.push(`- Target: ${context.targetAudience}`)
  if (context.toneOfVoice) parts.push(`- Tone of voice: ${context.toneOfVoice}`)
  if (context.uniqueValue) parts.push(`- Proposta di valore: ${context.uniqueValue}`)
  if (context.brandColors?.length) parts.push(`- Colori brand: ${context.brandColors.join(', ')}`)
  if (context.brandFonts?.length) parts.push(`- Font brand: ${context.brandFonts.join(', ')}`)
  if (context.services?.length) parts.push(`- Servizi: ${context.services.join(', ')}`)
  if (context.contactInfo) {
    const ci = context.contactInfo
    if (ci.phone) parts.push(`- Telefono: ${ci.phone}`)
    if (ci.email) parts.push(`- Email: ${ci.email}`)
    if (ci.address) parts.push(`- Indirizzo: ${ci.address}`)
  }

  return parts.join('\n')
}
