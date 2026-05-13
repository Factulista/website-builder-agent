import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { servePreview } from '../../../lib/preview'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const host = req.nextUrl.searchParams.get('host')

  if (!host) {
    return new Response('Invalid request', { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find project by custom domain
  const { data: project, error } = await supabase
    .from('projects')
    .select('slug, custom_domain_status')
    .eq('custom_domain', host)
    .is('deleted_at', null)
    .single()

  if (error || !project) {
    return new Response(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;color:#1c1917;background:#faf9f7;"><h1>Dominio non configurato</h1><p>Questo dominio non è configurato correttamente.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  if (project.custom_domain_status !== 'verified') {
    return new Response(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;color:#1c1917;background:#faf9f7;"><h1>Dominio in verifica</h1><p>Il dominio è in corso di verifica.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  // Extract page slug from path
  let pathname = req.nextUrl.pathname
  // Remove /api/serve-custom-domain prefix
  pathname = pathname.replace(/^\/api\/serve-custom-domain/, '')
  const pageSlug = pathname === '' || pathname === '/' ? 'home' : pathname.slice(1)

  return servePreview(project.slug, pageSlug)
}
