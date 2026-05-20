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

// GET /api/blog-posts?projectId=...
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId richiesto' }, { status: 400 })

  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const supabase = getSupabase()

  // Verify ownership
  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })

  const { data: posts, error } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, status, published_at, categories, tags, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ posts })
}

// POST /api/blog-posts — create a new post
export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json()
  const { projectId, title, slug, content_html, excerpt, featured_image, categories, tags, seo_title, seo_description } = body

  if (!projectId || !title || !slug) {
    return NextResponse.json({ error: 'projectId, title e slug richiesti' }, { status: 400 })
  }

  const supabase = getSupabase()

  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('user_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })

  const { data: post, error } = await supabase
    .from('blog_posts')
    .insert({
      project_id: projectId,
      title,
      slug,
      content_html: content_html ?? '',
      excerpt: excerpt ?? '',
      featured_image: featured_image ?? null,
      categories: categories ?? [],
      tags: tags ?? [],
      seo_title: seo_title ?? null,
      seo_description: seo_description ?? null,
      status: 'draft',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ post })
}
