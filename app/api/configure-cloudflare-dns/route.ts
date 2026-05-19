import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/** Safe JSON parse — returns null if the response is not JSON (e.g. CF returns HTML on auth errors) */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json()
  } catch {
    const text = await res.text().catch(() => '')
    console.error('configure-cloudflare-dns: non-JSON response', res.status, text.slice(0, 300))
    return null
  }
}

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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('configure-cloudflare-dns: missing Supabase env vars')
      return NextResponse.json({ error: 'Configurazione server mancante (Supabase env)' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      console.error('configure-cloudflare-dns: project lookup failed', projectError)
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

    // 2. List ALL existing root records (A, AAAA, CNAME) — Cloudflare blocks CNAME creation
    //    if ANY of these types already exist for the same hostname.
    const conflictingTypes = ['A', 'AAAA', 'CNAME']
    const recordsToDelete: { id: string; type: string }[] = []

    for (const recType of conflictingTypes) {
      const listRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records?type=${recType}&name=${encodeURIComponent(domain)}`,
        { headers: cfHeaders }
      )
      const listData = await safeJson(listRes) as { success: boolean; result?: { id: string; type: string }[]; errors?: { message: string }[] } | null

      if (!listData) {
        return NextResponse.json(
          { error: `Cloudflare ha risposto con ${listRes.status} (non-JSON). Verifica che API Token e Zone ID siano corretti.` },
          { status: 400 }
        )
      }

      if (!listData.success) {
        const msg = listData.errors?.[0]?.message ?? `Errore Cloudflare nel leggere i record ${recType}`
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      for (const rec of listData.result ?? []) {
        recordsToDelete.push({ id: rec.id, type: rec.type })
      }
    }

    // 3. Delete all conflicting records
    for (const record of recordsToDelete) {
      const delRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records/${record.id}`,
        { method: 'DELETE', headers: cfHeaders }
      )
      const delData = await safeJson(delRes) as { success: boolean; errors?: { message: string }[] } | null
      if (!delData) {
        return NextResponse.json(
          { error: `Cloudflare ha risposto con ${delRes.status} durante la cancellazione del record ${record.type}.` },
          { status: 400 }
        )
      }
      if (!delData.success) {
        const msg = delData.errors?.[0]?.message ?? `Errore Cloudflare nel cancellare il record ${record.type} esistente`
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
    const createData = await safeJson(createRes) as { success: boolean; errors?: { message: string }[] } | null
    if (!createData) {
      return NextResponse.json(
        { error: `Cloudflare ha risposto con ${createRes.status} durante la creazione del CNAME. Verifica i permessi del token.` },
        { status: 400 }
      )
    }
    if (!createData.success) {
      const msg = createData.errors?.[0]?.message ?? 'Errore Cloudflare nel creare il record CNAME'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Record CNAME aggiunto su Cloudflare. Proxy disabilitato (necessario per Vercel).',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('configure-cloudflare-dns error:', msg, error)
    return NextResponse.json({ error: `Errore interno: ${msg}` }, { status: 500 })
  }
}
