import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('p') || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'
  const slugParam = req.nextUrl.searchParams.get('slug')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  const cfg = (data?.site_config ?? {}) as Record<string, unknown>
  const pub = (cfg.published_pages as Array<Record<string, unknown>>) ?? []
  // ?versions=<slug> → scan project_versions snapshots for a complete copy of that page
  const versionsSlug = req.nextUrl.searchParams.get('versions')
  if (versionsSlug) {
    const { data: vrows } = await sb
      .from('project_versions')
      .select('id, summary, created_at, pages')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(30)
    const scan = (vrows ?? []).map(v => {
      const vpages = (v.pages as Array<Record<string, unknown>>) ?? []
      const pg = vpages.find(p => p.slug === versionsSlug)
      const html = (pg?.html as string) ?? ''
      return {
        id: v.id,
        created_at: v.created_at,
        summary: v.summary,
        found: !!pg,
        htmlLen: html.length,
        sectionCount: (html.match(/<section[^>]*>/g) ?? []).length,
      }
    })
    return NextResponse.json({ slug: versionsSlug, snapshots: scan })
  }

  if (slugParam) {
    const draftPages = (cfg.pages as Array<Record<string, unknown>>) ?? []
    const inspect = (list: Array<Record<string, unknown>>) => {
      const page = list.find(p => p.slug === slugParam)
      if (!page) return { found: false }
      const html = (page.html as string) ?? ''
      return {
        found: true,
        htmlLen: html.length,
        sectionCount: (html.match(/<section[^>]*>/g) ?? []).length,
        sections: (html.match(/<section[^>]*>/g) ?? []),
        keys: Object.keys(page),
        htmlStart: html.slice(0, 300),
      }
    }
    // Also expose top-level site_config keys so we can spot a different storage field
    return NextResponse.json({
      slug: slugParam,
      configKeys: Object.keys(cfg),
      draft: inspect(draftPages),
      published: inspect(pub),
    })
  }
  const mega = pub.filter(p => p.megaMenu === 'funcionalidades').map(p => ({ slug: p.slug, megaMenu: p.megaMenu, megaMenuIcon: p.megaMenuIcon, menuLabel: p.menuLabel, megaMenuLabel: p.megaMenuLabel }))
  return NextResponse.json({ total: pub.length, megaCount: mega.length, megaPages: mega })
}
