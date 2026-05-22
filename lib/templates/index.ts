import { SAAS_TEMPLATE } from './saas'
import { SAAS2_TEMPLATE } from './saas2'

export type Template = {
  id: string
  name: string
  sector: string
  description: string
  html: string
  keywords: string[]
}

const TEMPLATES: Record<string, string> = {
  saas: SAAS_TEMPLATE,
  saas2: SAAS2_TEMPLATE,
}

export const TEMPLATE_REGISTRY: Template[] = [
  {
    id: 'saas',
    name: 'Tech / Software Generico — Dark',
    sector: 'Tech',
    description: 'Template dark per startup tech, app, piattaforme SaaS generiche, CRM, ERP. Hero scuro, palette navy, design minimale e moderno.',
    html: SAAS_TEMPLATE,
    keywords: ['saas'],
  },
  {
    id: 'saas2',
    name: 'Fatturazione / Contabilità — Light',
    sector: 'Fintech',
    description: 'Template light per software di fatturazione, contabilità e gestione finanziaria. Hero bianco, comparazione modalità, 9 feature, pricing, form contatto.',
    html: SAAS2_TEMPLATE,
    keywords: ['invoicing'],
  },
]

export const TEMPLATE_MAP: Record<string, string[]> = {
  // saas → startup tech generiche, piattaforme, app, CRM/ERP senza focus fatturazione
  saas: ['saas', 'app', 'applicazione', 'piattaforma', 'platform', 'startup', 'tech', 'tecnologia', 'crm', 'erp'],
  // saas2 → software di fatturazione/contabilità per business, autonomos, pyme (IT/ES/PT)
  saas2: [
    'billing', 'contabilità', 'accounting', 'fintech', 'enterprise saas', 'b2b saas', 'gestionale cloud', 'erp cloud',
    'fatturazione', 'fatture', 'invoicing', 'invoice',
    'autonomos', 'autonomi', 'pyme', 'piccole imprese', 'partita iva',
    'fatturación', 'factura', 'facturas', 'facturación electrónica',
    'contabilidad', 'gestoría', 'asesoría fiscal',
  ],
}

/** Picks the template whose keywords have the most matches in the given text.
 *  Scoring avoids the "first match wins" bias that caused generic keywords like
 *  "saas" to beat more specific ones like "autonomos", "pyme", "fatturazione". */
export function detectTemplate(text: string): string | null {
  const lower = text.toLowerCase()
  let bestTemplate: string | null = null
  let bestScore = 0
  for (const [template, keywords] of Object.entries(TEMPLATE_MAP)) {
    const score = keywords.filter(k => lower.includes(k)).length
    if (score > bestScore) {
      bestScore = score
      bestTemplate = template
    }
  }
  return bestTemplate
}

export function loadTemplate(name: string): string | null {
  return TEMPLATES[name] ?? null
}

export function getTemplate(id: string): Template | null {
  return TEMPLATE_REGISTRY.find(t => t.id === id) ?? null
}

export function getAllTemplates(): Template[] {
  return TEMPLATE_REGISTRY
}

export type TemplateMeta = Omit<Template, 'html'>

/** Restituisce i template senza l'HTML — da usare nelle list view client-side
 *  per evitare di includere 100KB+ di template nel JS bundle. */
export function getAllTemplatesMeta(): TemplateMeta[] {
  return TEMPLATE_REGISTRY.map(({ html: _html, ...meta }) => meta)
}

export function getTemplatesBySector(sector: string): Template[] {
  return TEMPLATE_REGISTRY.filter(t => t.sector === sector)
}

/** Picks the best matching template from a combined list (DB templates + hardcoded).
 *  DB templates are prioritised (they come first). Same scoring logic as detectTemplate. */
export function detectTemplateFromList(templates: Template[], text: string): string | null {
  const lower = text.toLowerCase()
  let bestId: string | null = null
  let bestScore = 0
  for (const tmpl of templates) {
    const score = tmpl.keywords.filter(k => lower.includes(k.toLowerCase())).length
    if (score > bestScore) {
      bestScore = score
      bestId = tmpl.id
    }
  }
  return bestId
}

export function applyPlaceholders(html: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((acc, [key, val]) => {
    return acc.split(`{{${key}}}`).join(val ?? '')
  }, html)
}
