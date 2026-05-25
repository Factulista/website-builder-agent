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

    // Verify user owns the project
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

    const { data: project } = await supabase
      .from('projects')
      .select('id, custom_domain, custom_domain_status')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project?.custom_domain) {
      return NextResponse.json({ error: 'Nessun dominio configurato' }, { status: 404 })
    }

    if (project.custom_domain_status === 'verified') {
      return NextResponse.json({ status: 'verified', domain: project.custom_domain })
    }

    // Check domain status on Vercel
    const vercelToken = process.env.VERCEL_TOKEN
    const vercelProjectId = process.env.VERCEL_PROJECT_ID
    const vercelTeamId = process.env.VERCEL_TEAM_ID

    if (!vercelToken || !vercelProjectId) {
      return NextResponse.json({ error: 'Configurazione Vercel mancante' }, { status: 500 })
    }

    // teamId must be a query parameter
    const vercelUrl = new URL(`https://api.vercel.com/v9/projects/${vercelProjectId}/domains/${project.custom_domain}`)
    if (vercelTeamId) vercelUrl.searchParams.set('teamId', vercelTeamId)

    const vercelRes = await fetch(vercelUrl.toString(), {
      headers: { Authorization: `Bearer ${vercelToken}` },
    })

    if (!vercelRes.ok) {
      // 404 = domain not yet registered with Vercel → genuinely "pending"
      // 401/403 = our Vercel token is invalid/expired → server config error
      // 5xx = Vercel is down → caller should retry later
      if (vercelRes.status === 404) {
        return NextResponse.json({ status: 'pending', domain: project.custom_domain })
      }
      const errText = await vercelRes.text().catch(() => '')
      console.error('[verify-custom-domain] Vercel error', vercelRes.status, errText)
      if (vercelRes.status === 401 || vercelRes.status === 403) {
        return NextResponse.json({ error: 'Token Vercel non valido o scaduto. Contatta l\'amministratore.' }, { status: 502 })
      }
      return NextResponse.json({ error: `Vercel ha risposto ${vercelRes.status}. Riprova fra qualche secondo.` }, { status: 502 })
    }

    const vercelData = await vercelRes.json()
    const isVerified = vercelData.verified === true

    if (isVerified) {
      await supabase
        .from('projects')
        .update({ custom_domain_status: 'verified' })
        .eq('id', projectId)

      return NextResponse.json({ status: 'verified', domain: project.custom_domain })
    }

    return NextResponse.json({
      status: 'pending',
      domain: project.custom_domain,
      verification: vercelData.verification ?? [],
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
