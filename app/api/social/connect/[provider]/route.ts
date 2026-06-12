/**
 * GET /api/social/connect/[provider]
 * Authenticated. Returns the OAuth authorize URL for the user to visit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError } from '../../../../../lib/api-auth'
import { getProvider } from '../../../../../lib/social/providers'
import { signState } from '../../../../../lib/social/state'

export const runtime = 'nodejs'

function redirectUri(req: NextRequest, provider: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  return `${base.replace(/\/$/, '')}/api/social/callback/${provider}`
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await ctx.params
    const { user } = await requireUser(req)
    const prov = getProvider(provider)
    const state = signState({ userId: user.id, provider })
    const url = prov.getAuthUrl(redirectUri(req, provider), state)
    return NextResponse.json({ url })
  } catch (err) {
    return jsonError(err)
  }
}
