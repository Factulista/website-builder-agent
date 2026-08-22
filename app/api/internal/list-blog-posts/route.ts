/**
 * GET /api/internal/list-blog-posts?projectId=xxx
 * Diagnostic: dumps blog_posts for a project (id, title, slug, status,
 * scheduled_at, published_at, created_at) — read-only, mirrors list-pages
 * for the blog_posts table. Used to verify the scheduled-publish flow.
 */
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

  const { data, error } = await getSupabase()
    .from('blog_posts')
    .select('id, title, slug, status, scheduled_at, published_at, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ posts: data })
}
