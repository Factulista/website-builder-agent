/**
 * POST /api/client-log  Body: { projectId, where, message }
 * Lets the builder report failures that otherwise only reach the browser console
 * (e.g. version saves) to the server logs. Auth: signed-in project owner. Logs only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAndProjectOwnership, jsonError } from '../../../lib/api-auth'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const projectId = String(body?.projectId ?? '')
    const { user } = await requireUserAndProjectOwnership(req, projectId)
    console.error('[client-log]', JSON.stringify({
      user: user.id, projectId,
      where: String(body?.where ?? '').slice(0, 100),
      message: String(body?.message ?? '').slice(0, 2000),
    }))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
