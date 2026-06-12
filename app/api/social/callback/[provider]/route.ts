/**
 * GET /api/social/callback/[provider]
 * OAuth redirect target (no auth header — user identity comes from the signed state).
 * Exchanges the code, discovers targets, and stores one encrypted connection per target.
 * Redirects back to /social with a status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '../../../../../lib/api-auth'
import { getProvider } from '../../../../../lib/social/providers'
import { verifyState } from '../../../../../lib/social/state'
import { encryptToken } from '../../../../../lib/social/crypto'

export const runtime = 'nodejs'

function appUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params
  const base = appUrl(req)
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  const back = (status: string, extra = '') =>
    NextResponse.redirect(`${base}/social?connected=${provider}&status=${status}${extra}`)

  try {
    if (error) return back('denied')
    if (!code || !state) return back('error')

    const { userId } = verifyState(state)
    const prov = getProvider(provider)
    const redirectUri = `${base}/api/social/callback/${provider}`

    const tokens = await prov.exchangeCode(code, redirectUri)
    const targets = await prov.listTargets(tokens)
    if (targets.length === 0) return back('no_targets')

    const supabase = getServiceSupabase()
    for (const t of targets) {
      // For Facebook each target carries its own page token in meta.pageToken;
      // that's what we store as the connection's access_token.
      const tokenToStore = (t.meta?.pageToken as string) || tokens.accessToken
      const { pageToken: _omit, ...metaRest } = (t.meta ?? {}) as Record<string, unknown>
      await supabase.from('social_connections').upsert({
        user_id: userId,
        provider,
        external_id: t.externalId,
        account_name: t.name,
        access_token: encryptToken(tokenToStore),
        refresh_token: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        token_expires_at: tokens.expiresAt ?? null,
        scopes: tokens.scopes ?? null,
        meta: metaRest,
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider,external_id' })
    }

    return back('ok', `&count=${targets.length}`)
  } catch (err) {
    console.error('[social/callback]', err)
    return back('error')
  }
}
