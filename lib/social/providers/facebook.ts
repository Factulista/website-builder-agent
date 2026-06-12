/**
 * Facebook Pages provider (Graph API).
 *
 * Flow:
 *   1. OAuth → short-lived USER token → exchange for long-lived USER token (60d)
 *   2. me/accounts → list Pages, each with its own PAGE token (does NOT expire
 *      when derived from a long-lived user token)
 *   3. One connection is stored PER PAGE, with the PAGE token as access_token.
 *      So publish/delete/edit use the page token directly.
 *
 * Env: META_APP_ID, META_APP_SECRET
 */
import type {
  SocialProvider, ProviderTokens, ProviderTarget, PostContent, PublishResult,
} from '../types'

const GRAPH = 'https://graph.facebook.com/v21.0'

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
]

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
  const url = new URL(`${GRAPH}${path}`)
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), { method })
    const json = await res.json()
    if (json.error) throw new Error(`FB: ${json.error.message}`)
    return json
  }
  const body = new URLSearchParams(params)
  const res = await fetch(url.toString(), { method: 'POST', body })
  const json = await res.json()
  if (json.error) throw new Error(`FB: ${json.error.message}`)
  return json
}

export const facebookProvider: SocialProvider = {
  id: 'facebook',
  label: 'Facebook',
  capabilities: { edit: true, delete: true, schedule: true, requiresImage: false, maxChars: 63206 },

  getAuthUrl(redirectUri, state) {
    const appId = process.env.META_APP_ID
    if (!appId) throw new Error('META_APP_ID mancante')
    const u = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    u.searchParams.set('client_id', appId)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('state', state)
    u.searchParams.set('scope', SCOPES.join(','))
    u.searchParams.set('response_type', 'code')
    return u.toString()
  },

  async exchangeCode(code, redirectUri) {
    const appId = process.env.META_APP_ID!
    const secret = process.env.META_APP_SECRET!
    // 1) code → short-lived user token
    const short = await graph('/oauth/access_token', {
      client_id: appId, client_secret: secret, redirect_uri: redirectUri, code,
    })
    // 2) short-lived → long-lived user token (~60 days)
    const long = await graph('/oauth/access_token', {
      grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret,
      fb_exchange_token: short.access_token,
    })
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000).toISOString()
      : undefined
    return { accessToken: long.access_token, expiresAt, scopes: SCOPES.join(',') }
  },

  async listTargets(tokens) {
    // me/accounts returns the user's Pages, each with its own page access_token
    const res = await graph('/me/accounts', {
      access_token: tokens.accessToken,
      fields: 'id,name,access_token,picture{url}',
    })
    return (res.data ?? []).map((p: { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }): ProviderTarget => ({
      externalId: p.id,
      name: p.name,
      meta: { pageToken: p.access_token, picture: p.picture?.data?.url },
    }))
  },

  // For Facebook, the connection stores the PAGE token as tokens.accessToken.
  async publish(target, tokens, content) {
    const pageToken = tokens.accessToken
    let result: { id?: string; post_id?: string }
    if (content.mediaUrls && content.mediaUrls.length > 0) {
      // Photo post
      result = await graph(`/${target.externalId}/photos`, {
        url: content.mediaUrls[0],
        caption: content.text || '',
        access_token: pageToken,
      }, 'POST')
    } else {
      // Text / link post
      const params: Record<string, string> = { message: content.text || '', access_token: pageToken }
      if (content.link) params.link = content.link
      result = await graph(`/${target.externalId}/feed`, params, 'POST')
    }
    const externalId = result.post_id || result.id || ''
    return { externalId, url: externalId ? `https://www.facebook.com/${externalId}` : undefined } as PublishResult
  },

  async deletePost(_target, tokens, externalId) {
    await graph(`/${externalId}`, { access_token: tokens.accessToken }, 'DELETE')
  },

  async editPost(_target, tokens, externalId, content) {
    await graph(`/${externalId}`, { message: content.text || '', access_token: tokens.accessToken }, 'POST')
  },
}
