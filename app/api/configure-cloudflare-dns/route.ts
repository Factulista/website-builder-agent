import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { projectId, domain, cfApiToken, cfZoneId } = await req.json() as {
      projectId: string
      domain: string
      cfApiToken: string
      cfZoneId: string
    }

    if (!projectId || !domain || !cfApiToken || !cfZoneId) {
      return NextResponse.json(
        { error: 'projectId, domain, cfApiToken e cfZoneId sono richiesti' },
        { status: 400 }
      )
    }

    // Auth: Bearer token (Supabase)
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
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user || user.id !== project.user_id) {
      return NextResponse.json(
        { error: 'Non hai permesso di modificare questo progetto' },
        { status: 403 }
      )
    }

    const cfHeaders = {
      Authorization: `Bearer ${cfApiToken}`,
      'Content-Type': 'application/json',
    }

    // 2. List existing CNAME records for the root domain
    const listRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
      { headers: cfHeaders }
    )
    const listData = await listRes.json() as { success: boolean; result?: { id: string }[]; errors?: { message: string }[] }

    if (!listData.success) {
      const msg = listData.errors?.[0]?.message ?? 'Errore Cloudflare nel leggere i record DNS'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // 3. Delete any existing root CNAME
    for (const record of listData.result ?? []) {
      const delRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records/${record.id}`,
        { method: 'DELETE', headers: cfHeaders }
      )
      const delData = await delRes.json() as { success: boolean; errors?: { message: string }[] }
      if (!delData.success) {
        const msg = delData.errors?.[0]?.message ?? 'Errore Cloudflare nel cancellare il record DNS esistente'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    // 4. Create new CNAME pointing to Vercel — proxied: false (required for Vercel)
    const createRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records`,
      {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({
          type: 'CNAME',
          name: '@',
          content: 'cname.vercel-dns.com',
          ttl: 1,
          proxied: false,
        }),
      }
    )
    const createData = await createRes.json() as { success: boolean; errors?: { message: string }[] }

    if (!createData.success) {
      const msg = createData.errors?.[0]?.message ?? 'Errore Cloudflare nel creare il record CNAME'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Record CNAME aggiunto su Cloudflare. Proxy disabilitato (necessario per Vercel).',
    })
  } catch (error) {
    console.error('configure-cloudflare-dns error:', error)
    return NextResponse.json({ error: 'Errore interno del server' }, { status: 500 })
  }
}
