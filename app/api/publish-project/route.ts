import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json()
    if (!projectId) return NextResponse.json({ error: 'projectId richiesto' }, { status: 400 })

    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id, slug, site_config, custom_domain, custom_domain_status')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Progetto non trovato' }, { status: 404 })

    // The root-domain project (served at www.{ROOT_DOMAIN} via the ROOT_DOMAIN_PROJECT
    // env, not via a per-project custom_domain) is allowed to publish without a verified
    // custom domain. Otherwise require a verified custom domain as usual.
    const isRootDomainProject = !!process.env.ROOT_DOMAIN_PROJECT
      && project.slug === process.env.ROOT_DOMAIN_PROJECT

    if (!isRootDomainProject && (!project.custom_domain || project.custom_domain_status !== 'verified')) {
      return NextResponse.json({ error: 'Devi configurare e verificare un dominio personalizzato prima di pubblicare' }, { status: 400 })
    }

    const config = project.site_config as { pages?: unknown[]; messages?: unknown[]; published_pages?: unknown[] } | null
    if (!config?.pages || config.pages.length === 0) {
      return NextResponse.json({ error: 'Nessuna pagina da pubblicare' }, { status: 400 })
    }

    // Copy pages → published_pages
    const { error } = await supabase
      .from('projects')
      .update({
        site_config: { ...config, published_pages: config.pages },
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, publishedAt: new Date().toISOString() })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
