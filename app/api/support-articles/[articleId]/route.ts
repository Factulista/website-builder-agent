import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const { data: { user } } = await getSupabase().auth.getUser(auth.slice(7))
  return user
}

async function verifyArticleOwnership(articleId: string, userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('support_articles')
    .select('id, project_id, published_at, projects!inner(user_id)')
    .eq('id', articleId)
    .single()
  if (!data) return null
  const proj = data.projects as unknown as { user_id: string }
  if (proj.user_id !== userId) return null
  return data
}

// GET /api/support-articles/[articleId] — full article with content_html
export async function GET(req: NextRequest, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const article = await verifyArticleOwnership(articleId, user.id)
  if (!article) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })

  const { data, error } = await getSupabase()
    .from('support_articles').select('*').eq('id', articleId).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article: data })
}

// PATCH /api/support-articles/[articleId] — update fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyArticleOwnership(articleId, user.id)
  if (!existing) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })

  const body = await req.json()
  const allowed = ['title', 'slug', 'content_html', 'excerpt', 'category', 'tags', 'seo_title', 'seo_description', 'author', 'published_at', 'related_article_ids']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await getSupabase()
    .from('support_articles').update(updates).eq('id', articleId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article: data })
}

// POST /api/support-articles/[articleId]?action=publish|unpublish|schedule|unschedule
//
// Same rule as blog posts: published_at is the editorial date the user set in the
// sidebar and must always win. None of these actions ever touch it, except the
// one-time default the very first time an article goes live with no date chosen.
export async function POST(req: NextRequest, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params
  const action = req.nextUrl.searchParams.get('action')
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyArticleOwnership(articleId, user.id)
  if (!existing) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })

  let updates: Record<string, unknown>

  if (action === 'publish') {
    updates = {
      status: 'published',
      scheduled_at: null,
      ...(existing.published_at ? {} : { published_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }
  } else if (action === 'schedule') {
    const body = await req.json().catch(() => null) as { scheduledAt?: string } | null
    const scheduledAt = body?.scheduledAt
    if (!scheduledAt || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) {
      return NextResponse.json({ error: 'Data non valida (atteso YYYY-MM-DD)' }, { status: 400 })
    }
    updates = { status: 'scheduled', scheduled_at: scheduledAt, updated_at: new Date().toISOString() }
  } else if (action === 'unschedule') {
    updates = { status: 'draft', scheduled_at: null, updated_at: new Date().toISOString() }
  } else {
    // unpublish (default/back-compat)
    updates = { status: 'draft', scheduled_at: null, updated_at: new Date().toISOString() }
  }

  const { data, error } = await getSupabase()
    .from('support_articles').update(updates).eq('id', articleId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article: data })
}

// DELETE /api/support-articles/[articleId]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyArticleOwnership(articleId, user.id)
  if (!existing) return NextResponse.json({ error: 'Articolo non trovato' }, { status: 404 })

  const { error } = await getSupabase().from('support_articles').delete().eq('id', articleId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
