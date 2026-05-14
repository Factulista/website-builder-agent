import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'

const TEMPLATES_DIR = resolve(dirname(new URL(import.meta.url).pathname))

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
  try {
    return readFileSync(resolve(TEMPLATES_DIR, `${name}.html`), 'utf-8')
  } catch {
    return null
  }
}

export function applyPlaceholders(html: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((acc, [key, val]) => {
    return acc.replaceAll(`{{${key}}}`, val ?? '')
  }, html)
}
