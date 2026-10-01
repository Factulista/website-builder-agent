import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readAllPages } from '../../../../lib/pages-store'
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
  let all: Awaited<ReturnType<typeof readAllPages>>
  try { all = await readAllPages(getSupabase(), projectId) } catch { return NextResponse.json({ error: 'not found' }, { status: 404 }) }
  const config = { pages: all.draft, published_pages: all.published } as Record<string, unknown>
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
