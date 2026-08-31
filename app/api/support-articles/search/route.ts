import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// Public, unauthenticated search over a project's PUBLISHED support articles — powers
// the search bar on the Ayuda hub page (/ayuda). No auth: this is public site content,
// same trust level as browsing the articles directly. Only ever returns published rows
// (never drafts/scheduled), mirroring the same safeguard already applied to the public
// blog single-post routes.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const category = req.nextUrl.searchParams.get('category')

  if (!projectId) return NextResponse.json({ error: 'projectId richiesto' }, { status: 400 })
  if (!q && !category) return NextResponse.json({ articles: [] })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (q) {
    // Ranked full-text search (ts_rank) via a DB function — also folds accents on both
    // the query and the stored content, so "facturacion" matches "facturación".
    const { data: articles, error } = await supabase.rpc('search_support_articles', {
      p_project_id: projectId,
      p_query: q,
      p_category: category || null,
      p_limit: 20,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ articles: articles ?? [] })
  }

  // category-only browse (no free-text query): plain filter, most recent first.
  const { data: articles, error } = await supabase
    .from('support_articles')
    .select('id, title, slug, excerpt, category')
    .eq('project_id', projectId)
    .eq('status', 'published')
    .eq('category', category as string)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articles: articles ?? [] })
}
