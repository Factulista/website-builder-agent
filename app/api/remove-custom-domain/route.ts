import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json()

    if (!projectId) {
      return NextResponse.json({ error: 'projectId richiesto' }, { status: 400 })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }
    const token = authHeader.slice(7)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id, custom_domain')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) {
      return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })
    }

    const domain = project.custom_domain
    if (!domain) {
      return NextResponse.json({ error: 'Nessun dominio configurato' }, { status: 400 })
    }

    // Remove domain from Vercel
    const vercelToken = process.env.VERCEL_TOKEN
    const vercelProjectId = process.env.VERCEL_PROJECT_ID
    const vercelTeamId = process.env.VERCEL_TEAM_ID

    if (vercelToken && vercelProjectId) {
      const url = new URL(`https://api.vercel.com/v9/projects/${vercelProjectId}/domains/${domain}`)
      if (vercelTeamId) url.searchParams.set('teamId', vercelTeamId)

      await fetch(url.toString(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${vercelToken}` },
      })
      // Ignore Vercel errors — domain might already be gone, we still clear the DB
    }

    // Clear domain from DB
    await supabase
      .from('projects')
      .update({ custom_domain: null, custom_domain_status: null })
      .eq('id', projectId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('remove-custom-domain error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
