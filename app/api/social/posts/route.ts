/**
 * Social posts CRUD (drafts + history).
 * GET    /api/social/posts            → list user's posts
 * POST   /api/social/posts            → create a draft  { content, connectionIds, sourceType?, sourceRef?, sourceProjectId?, scheduledAt? }
 * PATCH  /api/social/posts?id=xxx     → update a draft
 * DELETE /api/social/posts?id=xxx     → delete a post record (does NOT delete on the network)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError } from '../../../../lib/api-auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const { data, error } = await supabase
      .from('social_posts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return NextResponse.json({ posts: data ?? [] })
  } catch (err) {
    return jsonError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const body = await req.json()
    const { content, connectionIds, sourceType, sourceRef, sourceProjectId, scheduledAt } = body
    if (!content?.text && !(content?.mediaUrls?.length)) {
      return NextResponse.json({ error: 'Contenuto vuoto' }, { status: 400 })
    }
    const { data, error } = await supabase.from('social_posts').insert({
      user_id: user.id,
      source_type: sourceType ?? 'manual',
      source_ref: sourceRef ?? null,
      source_project_id: sourceProjectId ?? null,
      content,
      connection_ids: connectionIds ?? [],
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: scheduledAt ?? null,
    }).select().single()
    if (error) throw error
    return NextResponse.json({ post: data })
  } catch (err) {
    return jsonError(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 })
    const body = await req.json()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['content', 'connection_ids', 'status', 'scheduled_at'] as const) {
      if (k in body) patch[k] = body[k]
    }
    const { data, error } = await supabase
      .from('social_posts')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select().single()
    if (error) throw error
    return NextResponse.json({ post: data })
  } catch (err) {
    return jsonError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 })
    const { error } = await supabase.from('social_posts').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return jsonError(err)
  }
}
