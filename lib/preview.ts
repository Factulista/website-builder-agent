import { createClient } from '@supabase/supabase-js'

type Page = { slug: string; name: string; html: string }
type SiteConfig = { html?: string; pages?: Page[] } | null

function injectBase(html: string, projectSlug: string): string {
  const baseTag = `<base href="/preview/${projectSlug}/">`
  if (/<base[^>]*>/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
  }
  return baseTag + html
}

function errorPage(status: number, title: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;color:#1c1917;background:#faf9f7;"><h1 style="margin-bottom:1rem;">${title}</h1><p>${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function servePreview(projectSlug: string, pageSlug: string = 'home') {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('projects')
    .select('site_config, name')
    .eq('slug', projectSlug)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    return errorPage(404, '404', 'Sito non trovato')
  }

  const config = data.site_config as SiteConfig

  // Resolve page: try new "pages" array first, fall back to legacy single "html"
  let pageHtml: string | undefined
  if (config?.pages && config.pages.length > 0) {
    const page = config.pages.find(p => p.slug === pageSlug)
    if (!page) {
      return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste in questo sito.`)
    }
    pageHtml = page.html
  } else if (pageSlug === 'home' && config?.html) {
    pageHtml = config.html
  }

  if (!pageHtml) {
    return errorPage(200, data.name, 'Il sito non è ancora stato generato.')
  }

  return new Response(injectBase(pageHtml, projectSlug), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  })
}
