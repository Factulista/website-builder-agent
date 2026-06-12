/**
 * GET    /api/social/connections        → list the user's connections (NO tokens)
 * DELETE /api/social/connections?id=xxx  → remove a connection
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError } from '../../../../lib/api-auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const { data, error } = await supabase
      .from('social_connections')
      .select('id, provider, external_id, account_name, token_expires_at, scopes, meta, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    return NextResponse.json({ connections: data ?? [] })
  } catch (err) {
    return jsonError(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 })
    const { error } = await supabase
      .from('social_connections')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    return jsonError(err)
  }
}
