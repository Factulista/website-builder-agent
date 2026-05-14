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

    if (!vercelToken || !vercelProjectId) {
      return NextResponse.json({ error: 'Configurazione Vercel mancante' }, { status: 500 })
    }

    const vercelRes = await fetch(
      `https://api.vercel.com/v9/projects/${vercelProjectId}/domains/${project.custom_domain}`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    )

    if (!vercelRes.ok) {
      return NextResponse.json({ status: 'pending', domain: project.custom_domain })
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
