import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { projectId, domain } = await req.json()

    if (!projectId || !domain) {
      return NextResponse.json(
        { error: 'projectId e domain sono richiesti' },
        { status: 400 }
      )
    }

    // Validate domain format
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
    if (!domainRegex.test(domain)) {
      return NextResponse.json(
        { error: 'Formato dominio non valido' },
        { status: 400 }
      )
    }

    // Get user session
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Non autorizzato' },
        { status: 401 }
      )
    }

    const token = authHeader.slice(7)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Progetto non trovato' },
        { status: 404 }
      )
    }

    // Verify session belongs to project owner
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user || user.id !== project.user_id) {
      return NextResponse.json(
        { error: 'Non hai permesso di modificare questo progetto' },
        { status: 403 }
      )
    }

    // Add custom domain to Vercel
    const vercelTeamId = process.env.VERCEL_TEAM_ID
    const vercelProjectId = process.env.VERCEL_PROJECT_ID
    const vercelToken = process.env.VERCEL_TOKEN

    if (!vercelToken || !vercelProjectId) {
      return NextResponse.json(
        { error: 'Configurazione Vercel non disponibile' },
        { status: 500 }
      )
    }

    const vercelResponse = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
        ...(vercelTeamId && { 'teamId': vercelTeamId }),
      },
      body: JSON.stringify({ name: domain }),
    })

    if (!vercelResponse.ok) {
      const errorData = await vercelResponse.json()
      console.error('Vercel error:', errorData)
      return NextResponse.json(
        { error: 'Errore nell\'aggiungere il dominio a Vercel' },
        { status: 500 }
      )
    }

    const vercelData = await vercelResponse.json()

    // Save custom domain to database
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        custom_domain: domain,
        custom_domain_status: 'pending',
      })
      .eq('id', projectId)

    if (updateError) {
      return NextResponse.json(
        { error: 'Errore nel salvare il dominio' },
        { status: 500 }
      )
    }

    // Return DNS instructions
    return NextResponse.json({
      domain,
      status: 'pending',
      dnsInstructions: {
        type: 'CNAME',
        name: '@',
        value: 'cname.vercel-dns.com',
        ttl: 3600,
      },
      message: `Aggiungi questo record CNAME al tuo registrar DNS:\nNome: @\nValore: cname.vercel-dns.com\n\nDopo la configurazione, il dominio sarà verificato automaticamente.`,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}
