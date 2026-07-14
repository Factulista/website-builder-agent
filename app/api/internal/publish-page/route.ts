/**
 * POST /api/internal/publish-page
 * Body: { projectId, slug }
 * Copies a draft page (pages[]) into published_pages[], making it live.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const slug = body?.slug as string | undefined
  if (!projectId || !slug) return NextResponse.json({ error: 'projectId and slug required' }, { status: 400 })
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{slug:string;html?:string}> | undefined) ?? []
  const draft = pages.find(p => p.slug === slug)
  if (!draft) return NextResponse.json({ error: `draft page "${slug}" not found` }, { status: 404 })
  const published = (config.published_pages as Array<{slug:string;html?:string}> | undefined) ?? []
  const existing = published.findIndex(p => p.slug === slug)
  const updated = existing >= 0
    ? published.map((p, i) => i === existing ? { ...draft } : p)
    : [...published, { ...draft }]
  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, published_pages: updated },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: `Page "${slug}" published (${draft.html?.length ?? 0} chars)` })
}
