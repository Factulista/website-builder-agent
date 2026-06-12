/**
 * POST /api/social/publish
 * Body: { postId }  OR  { content, connectionIds, sourceType?, sourceRef?, sourceProjectId? }
 *
 * Publishes a post to each target connection. Decrypts tokens server-side, calls
 * the provider, and records a per-connection result. Status becomes:
 *   published  → all targets ok
 *   partial    → some ok, some failed
 *   failed     → all failed
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError, getServiceSupabase } from '../../../../lib/api-auth'
import { getProvider } from '../../../../lib/social/providers'
import { decryptToken } from '../../../../lib/social/crypto'
import type { PostContent } from '../../../../lib/social/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const body = await req.json()
    let postId: string | undefined = body.postId

    // Inline create-and-publish
    if (!postId) {
      const content: PostContent = body.content
      if (!content?.text && !content?.mediaUrls?.length) {
        return NextResponse.json({ error: 'Contenuto vuoto' }, { status: 400 })
      }
      const { data, error } = await supabase.from('social_posts').insert({
        user_id: user.id,
        source_type: body.sourceType ?? 'manual',
        source_ref: body.sourceRef ?? null,
        source_project_id: body.sourceProjectId ?? null,
        content,
        connection_ids: body.connectionIds ?? [],
        status: 'publishing',
      }).select().single()
      if (error) throw error
      postId = data.id
    } else {
      await supabase.from('social_posts').update({ status: 'publishing' }).eq('id', postId).eq('user_id', user.id)
    }

    // Load the post
    const { data: post, error: pErr } = await supabase
      .from('social_posts').select('*').eq('id', postId).eq('user_id', user.id).single()
    if (pErr || !post) return NextResponse.json({ error: 'Post non trovato' }, { status: 404 })

    const connIds: string[] = post.connection_ids ?? []
    if (connIds.length === 0) return NextResponse.json({ error: 'Nessuna connessione selezionata' }, { status: 400 })

    // Load the target connections (service role — tokens are encrypted)
    const admin = getServiceSupabase()
    const { data: conns } = await admin
      .from('social_connections').select('*').in('id', connIds).eq('user_id', user.id)

    const content: PostContent = post.content
    const results: Record<string, unknown> = { ...(post.results ?? {}) }
    let okCount = 0

    for (const conn of conns ?? []) {
      try {
        const provider = getProvider(conn.provider)
        if (provider.capabilities.requiresImage && !content.mediaUrls?.length) {
          throw new Error(`${provider.label} richiede un'immagine`)
        }
        const tokens = {
          accessToken: decryptToken(conn.access_token),
          refreshToken: conn.refresh_token ? decryptToken(conn.refresh_token) : undefined,
          expiresAt: conn.token_expires_at ?? undefined,
        }
        const target = { externalId: conn.external_id, name: conn.account_name ?? '', meta: conn.meta ?? {} }
        const res = await provider.publish(target, tokens, content)
        results[conn.id] = { status: 'published', externalId: res.externalId, url: res.url, network: conn.provider }
        okCount++
      } catch (e) {
        results[conn.id] = { status: 'failed', error: String(e instanceof Error ? e.message : e), network: conn.provider }
      }
    }

    const status = okCount === (conns?.length ?? 0) ? 'published' : okCount > 0 ? 'partial' : 'failed'
    await supabase.from('social_posts')
      .update({ status, results, updated_at: new Date().toISOString() })
      .eq('id', postId).eq('user_id', user.id)

    return NextResponse.json({ postId, status, results })
  } catch (err) {
    return jsonError(err)
  }
}
