import { SAAS_TEMPLATE } from './saas'

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
}

export const TEMPLATE_REGISTRY: Template[] = [
  {
    id: 'saas',
    name: 'SaaS / Software',
    sector: 'SaaS',
    description: 'Template per applicazioni web, piattaforme SaaS, software e startup tech. Perfetto per prodotti digitali, CRM, ERP e soluzioni di fatturazione.',
    html: SAAS_TEMPLATE,
    keywords: ['saas', 'software', 'app', 'applicazione', 'piattaforma', 'platform', 'startup', 'tech', 'tecnologia', 'fatturazione', 'invoicing', 'crm', 'erp', 'gestionale'],
  },
]

export const TEMPLATE_MAP: Record<string, string[]> = {
  saas: ['saas', 'software', 'app', 'applicazione', 'piattaforma', 'platform', 'startup', 'tech', 'tecnologia', 'fatturazione', 'invoicing', 'crm', 'erp', 'gestionale'],
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
