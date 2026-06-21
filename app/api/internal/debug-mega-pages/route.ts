import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('p') || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb.from('projects').select('site_config').eq('id', projectId).single()
  const cfg = (data?.site_config ?? {}) as Record<string, unknown>
  const pub = (cfg.published_pages as Array<Record<string, unknown>>) ?? []
  const mega = pub.filter(p => p.megaMenu === 'funcionalidades').map(p => ({ slug: p.slug, megaMenu: p.megaMenu, megaMenuIcon: p.megaMenuIcon, menuLabel: p.menuLabel, megaMenuLabel: p.megaMenuLabel }))
  return NextResponse.json({ total: pub.length, megaCount: mega.length, megaPages: mega })
}
