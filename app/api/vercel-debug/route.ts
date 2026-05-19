import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Temporary diagnostic endpoint — shows what Vercel env vars the server sees
 * and calls the Vercel API to verify the token+project combo works.
 * DELETE this route once the custom domain feature is confirmed working.
 */
export async function GET(req: NextRequest) {
  const vercelToken    = process.env.VERCEL_TOKEN     ?? null
  const vercelProjectId = process.env.VERCEL_PROJECT_ID ?? null
  const vercelTeamId   = process.env.VERCEL_TEAM_ID   ?? null

  const info: Record<string, string | null | object> = {
    VERCEL_TOKEN:      vercelToken ? `${vercelToken.slice(0, 6)}…(masked)` : 'NOT SET',
    VERCEL_PROJECT_ID: vercelProjectId ?? 'NOT SET',
    VERCEL_TEAM_ID:    vercelTeamId    ?? 'NOT SET',
  }

  if (!vercelToken || !vercelProjectId) {
    return NextResponse.json({ ok: false, info, error: 'Token o Project ID mancanti' })
  }

  // Try to fetch the project from Vercel API
  const url = new URL(`https://api.vercel.com/v9/projects/${vercelProjectId}`)
  if (vercelTeamId) url.searchParams.set('teamId', vercelTeamId)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${vercelToken}` },
    })
    const body = await res.json().catch(() => null)

    info.vercel_http_status = String(res.status)
    info.vercel_response = body

    if (res.ok) {
      info.project_name = (body as { name?: string })?.name ?? 'unknown'
      return NextResponse.json({ ok: true, info })
    }

    // If 404 and no teamId set, try to list teams to help diagnose
    if (res.status === 404 && !vercelTeamId) {
      const teamsRes = await fetch('https://api.vercel.com/v2/teams', {
        headers: { Authorization: `Bearer ${vercelToken}` },
      })
      const teamsBody = await teamsRes.json().catch(() => null)
      info.teams = (teamsBody as { teams?: { id: string; name: string; slug: string }[] })?.teams?.map(
        t => ({ id: t.id, name: t.name, slug: t.slug })
      ) ?? 'error fetching teams'
    }

    return NextResponse.json({ ok: false, info })
  } catch (err) {
    return NextResponse.json({ ok: false, info, error: String(err) })
  }
}
