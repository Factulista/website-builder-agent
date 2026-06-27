/**
 * Read/write a single DRAFT page (one-shot helper).
 *  GET  ?slug=...       → returns full draft HTML
 *  POST { slug, html }  → writes HTML to site_config.pages ONLY (not published)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

const PROJECT = '6a436817-7c0a-40ed-aa26-8aeffdc128f4'
function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  const projectId = req.nextUrl.searchParams.get('projectId') || PROJECT
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  const { data } = await sb().from('projects').select('site_config').eq('id', projectId).single()
  const cfg = (data?.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const p = pages.find(x => x.slug === slug)
  if (!p) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ slug, html: p.html })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.slug !== 'string' || typeof body.html !== 'string') {
    return NextResponse.json({ error: 'body must be { slug, html }' }, { status: 400 })
  }
  const projectId = (body.projectId as string) || PROJECT
  if (body.html.length < 1000) return NextResponse.json({ error: 'html too short' }, { status: 400 })
  const supa = sb()
  const { data, error } = await supa.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const idx = pages.findIndex(x => x.slug === body.slug)
  if (idx === -1) return NextResponse.json({ error: 'slug not found' }, { status: 404 })
  const next = [...pages]
  const { blocks: _b, ...rest } = next[idx]
  void _b
  next[idx] = { ...rest, html: body.html }
  const { error: saveErr } = await supa.from('projects').update({
    site_config: { ...cfg, pages: next }, updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, slug: body.slug, written: body.html.length })
}
