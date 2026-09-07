import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
// One-off: dumps every field except `html`/`blocks` for a page, from both draft and
// published arrays, for debugging fields like inMenu that list-pages doesn't expose.
export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectId = req.nextUrl.searchParams.get('projectId')
  const slug = req.nextUrl.searchParams.get('slug')
  if (!projectId || !slug) return NextResponse.json({ error: 'projectId and slug required' }, { status: 400 })
  const { data, error } = await getSupabase().from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const config = (data.site_config ?? {}) as Record<string, unknown>
  const strip = (p: Record<string, unknown> | undefined) => {
    if (!p) return null
    const { html: _html, blocks: _blocks, ...rest } = p
    return rest
  }
  const pages = (config.pages as Array<Record<string, unknown> & { slug: string }> | undefined) ?? []
  const published = (config.published_pages as Array<Record<string, unknown> & { slug: string }> | undefined) ?? []
  return NextResponse.json({
    draft: strip(pages.find(p => p.slug === slug)),
    published: strip(published.find(p => p.slug === slug)),
  })
}
