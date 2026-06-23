/**
 * POST /api/internal/add-redirects  (one-shot)
 * Adds 301 redirects from the old funcionalidades slugs to the new ones.
 * Merges into site_config.redirects (de-duplicated by `from`).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

const REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/gestion-de-compras-y-gastos', to: '/gestion-de-facturas-recibidas-y-gastos' },
  { from: '/informes-y-analiticas', to: '/informes-avanzados' },
  { from: '/gestion-de-clientes', to: '/gestion-de-clientes-y-proveedores' },
  { from: '/cumplimiento-fiscal', to: '/cumplimiento-normativo' },
]

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const projectId = (body?.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const existing = (cfg.redirects as Array<{ from: string; to: string }>) ?? []

  // Keep existing redirects except any that share a `from` with the new ones, then append new.
  const newFroms = new Set(REDIRECTS.map(r => r.from))
  const merged = [...existing.filter(r => !newFroms.has(r.from)), ...REDIRECTS]

  const { error: saveErr } = await sb.from('projects').update({
    site_config: { ...cfg, redirects: merged },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, added: REDIRECTS, totalRedirects: merged.length })
}
