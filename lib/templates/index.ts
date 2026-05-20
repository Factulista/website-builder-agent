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
    name: 'SaaS / Software — Dark',
    sector: 'SaaS',
    description: 'Template dark per applicazioni web, piattaforme SaaS, software e startup tech. Hero scuro, palette navy, design minimale.',
    html: SAAS_TEMPLATE,
    keywords: ['saas', 'software', 'app', 'applicazione', 'piattaforma', 'platform', 'startup', 'tech', 'tecnologia', 'fatturazione', 'invoicing', 'crm', 'erp', 'gestionale'],
  },
  {
    id: 'saas2',
    name: 'SaaS / Software — Light',
    sector: 'SaaS',
    description: 'Template light per SaaS e prodotti tech. Hero bianco con gradiente, sezione comparazione modalità, griglia 9 feature, pricing 2 piani, form contatto. Ispirato a factulista.com.',
    html: SAAS2_TEMPLATE,
    keywords: ['saas light', 'software light', 'gestionale', 'billing', 'invoicing light', 'b2b saas', 'fintech', 'enterprise', 'contabilità', 'accounting', 'erp light', 'crm light'],
  },
]

export const TEMPLATE_MAP: Record<string, string[]> = {
  // saas (dark) → startup tech generiche, piattaforme, no fatturazione specifica
  saas: ['saas', 'software', 'app', 'applicazione', 'piattaforma', 'platform', 'startup', 'tech', 'tecnologia', 'crm', 'erp', 'gestionale'],
  // saas2 (light) → prodotti di fatturazione/contabilità per business, autonomos, pyme
  saas2: [
    'billing', 'contabilità', 'accounting', 'fintech', 'enterprise saas', 'b2b saas', 'gestionale cloud', 'erp cloud',
    'fatturazione', 'fatture', 'invoicing', 'invoice',
    'autonomos', 'autonomi', 'pyme', 'piccole imprese', 'partita iva',
    'fatturación', 'factura', 'facturas', 'facturación electrónica',
    'contabilidad', 'gestoría', 'asesoría fiscal',
  ],
}

export function detectTemplate(businessType: string): string | null {
  const lower = businessType.toLowerCase()
  for (const [template, keywords] of Object.entries(TEMPLATE_MAP)) {
    if (keywords.some(k => lower.includes(k))) return template
  }
  return null
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

export function getTemplatesBySector(sector: string): Template[] {
  return TEMPLATE_REGISTRY.filter(t => t.sector === sector)
}

export function applyPlaceholders(html: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((acc, [key, val]) => {
    return acc.split(`{{${key}}}`).join(val ?? '')
  }, html)
}
