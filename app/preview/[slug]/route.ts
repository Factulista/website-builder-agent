import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('projects')
    .select('site_config, name')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;"><h1>404</h1><p>Sito non trovato</p></body></html>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const html = (data.site_config as { html?: string } | null)?.html

  if (!html) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;"><h1>${data.name}</h1><p>Il sito non è ancora stato generato.</p></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  })
}
