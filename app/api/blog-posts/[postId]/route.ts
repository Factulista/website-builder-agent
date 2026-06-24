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

async function verifyPostOwnership(postId: string, userId: string) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('blog_posts')
    .select('id, project_id, projects!inner(user_id)')
    .eq('id', postId)
    .single()
  if (!data) return null
  const proj = data.projects as unknown as { user_id: string }
  if (proj.user_id !== userId) return null
  return data
}

// GET /api/blog-posts/[postId] — full post with content_html
export async function GET(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const post = await verifyPostOwnership(postId, user.id)
  if (!post) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })

  const { data, error } = await getSupabase()
    .from('blog_posts').select('*').eq('id', postId).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ post: data })
}

// PATCH /api/blog-posts/[postId] — update fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyPostOwnership(postId, user.id)
  if (!existing) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })

  const body = await req.json()
  const allowed = ['title', 'slug', 'content_html', 'excerpt', 'featured_image', 'categories', 'tags', 'seo_title', 'seo_description', 'author', 'published_at', 'related_post_ids']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await getSupabase()
    .from('blog_posts').update(updates).eq('id', postId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ post: data })
}

// POST /api/blog-posts/[postId]?action=publish|unpublish
export async function POST(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const action = req.nextUrl.searchParams.get('action')
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyPostOwnership(postId, user.id)
  if (!existing) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })

  const updates =
    action === 'publish'
      ? { status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'draft', published_at: null, updated_at: new Date().toISOString() }

  const { data, error } = await getSupabase()
    .from('blog_posts').update(updates).eq('id', postId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ post: data })
}

// DELETE /api/blog-posts/[postId]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const existing = await verifyPostOwnership(postId, user.id)
  if (!existing) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })

  const { error } = await getSupabase().from('blog_posts').delete().eq('id', postId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
