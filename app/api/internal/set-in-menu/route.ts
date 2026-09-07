/**
 * POST /api/internal/set-in-menu
 * Body: { projectId, slugs: string[], value: boolean }
 * Force-sets the `inMenu` field on the given pages, in BOTH pages (draft) and
 * published_pages — bypasses the builder UI entirely for when its own toggle keeps
 * reverting (a live-edits collision from a stale open tab resaving over it).
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
  const slugs = (body?.slugs as string[] | undefined) ?? []
  const value = body?.value as boolean | undefined
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (slugs.length === 0) return NextResponse.json({ error: 'slugs required' }, { status: 400 })
  if (typeof value !== 'boolean') return NextResponse.json({ error: 'value (boolean) required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const config = (data.site_config ?? {}) as Record<string, unknown>
  const slugSet = new Set(slugs)
  const applyTo = (arr: Array<Record<string, unknown> & { slug: string }> | undefined) =>
    (arr ?? []).map(p => slugSet.has(p.slug) ? { ...p, inMenu: value } : p)

  const pages = applyTo(config.pages as Array<Record<string, unknown> & { slug: string }> | undefined)
  const published = applyTo(config.published_pages as Array<Record<string, unknown> & { slug: string }> | undefined)

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...config, pages, published_pages: published },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)
  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: `inMenu=${value} impostato su ${slugs.length} pagine (draft + published)` })
}
