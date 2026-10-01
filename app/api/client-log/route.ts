/**
 * POST /api/client-log  Body: { projectId, where, message }
 * Lets the builder report failures that otherwise only reach the browser console
 * (e.g. version saves) to the server logs. Auth: signed-in project owner. Logs only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAndProjectOwnership, jsonError, getServiceSupabase } from '../../../lib/api-auth'
import { patchSiteConfig } from '../../../lib/site-config-patch'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const projectId = String(body?.projectId ?? '')
    const { user } = await requireUserAndProjectOwnership(req, projectId)
    const entry = {
      at: new Date().toISOString(), user: user.id,
      where: String(body?.where ?? '').slice(0, 100),
      message: String(body?.message ?? '').slice(0, 2000),
    }
    console.error('[client-log]', JSON.stringify({ projectId, ...entry }))
    // Also keep the last 30 in site_config._client_errors (server logs aren't
    // retained on the Vercel Hobby plan).
    const sb = getServiceSupabase()
    const { data } = await sb.from('projects').select('e:site_config->_client_errors').eq('id', projectId).single()
    const prev = Array.isArray((data as { e?: unknown } | null)?.e) ? (data as { e: unknown[] }).e : []
    await patchSiteConfig(sb, projectId, [{ path: ['_client_errors'], value: [...prev, entry].slice(-30) }])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
