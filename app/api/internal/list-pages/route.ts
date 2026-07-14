import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const config = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<{slug:string;html?:string;megaMenu?:string;megaMenuLabel?:string;megaMenuIcon?:string}> | undefined) ?? []
  const published = (config.published_pages as Array<{slug:string;name?:string;html?:string;megaMenu?:string;megaMenuLabel?:string;megaMenuIcon?:string}> | undefined) ?? []
  const publishedSlugs = new Set(published.map(p => p.slug))
  return NextResponse.json({
    drafts: pages.map(p => ({ slug: p.slug, size: p.html?.length ?? 0, published: publishedSlugs.has(p.slug), megaMenu: p.megaMenu ?? null, megaMenuLabel: p.megaMenuLabel ?? null, megaMenuIcon: p.megaMenuIcon ?? null })),
    published: published.map(p => ({ slug: p.slug, name: p.name ?? null, size: p.html?.length ?? 0, megaMenu: p.megaMenu ?? null, megaMenuLabel: p.megaMenuLabel ?? null, megaMenuIcon: p.megaMenuIcon ?? null }))
  })
}
