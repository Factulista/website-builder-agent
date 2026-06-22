/**
 * POST /api/internal/republish-funcionalidades
 * Copies pages[slug].html → published_pages[slug].html for the 5 broken
 * funcionalidades slugs (whose draft is intact but published was corrupted).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

const SLUGS = [
  'control-de-pagos-y-cobros',
  'gestion-de-facturas-recibidas-y-gastos',
  'informes-avanzados',
  'gestion-de-clientes-y-proveedores',
  'cumplimiento-normativo',
]

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const projectId = (body?.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const published = (cfg.published_pages as Array<Record<string, unknown>>) ?? []

  const results: Record<string, string> = {}

  const newPublished = published.map(p => {
    const slug = p.slug as string
    if (!SLUGS.includes(slug)) return p
    const draft = pages.find(d => d.slug === slug)
    if (!draft?.html) { results[slug] = 'draft not found'; return p }
    results[slug] = `copied (${(draft.html as string).length} chars)`
    return { ...p, html: draft.html }
  })

  // Also handle pages that exist in draft but not yet in published
  for (const slug of SLUGS) {
    if (!newPublished.find(p => p.slug === slug)) {
      const draft = pages.find(d => d.slug === slug)
      if (draft) {
        newPublished.push({ ...draft })
        results[slug] = `added from draft (${(draft.html as string).length} chars)`
      } else {
        results[slug] = results[slug] ?? 'not found in draft either'
      }
    }
  }

  const { error: saveErr } = await sb.from('projects').update({
    site_config: { ...cfg, published_pages: newPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, results })
}
