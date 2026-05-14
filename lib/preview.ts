import { createClient } from '@supabase/supabase-js'

type Page = { slug: string; name: string; html: string }
type SiteConfig = { html?: string; pages?: Page[]; published_pages?: Page[] } | null

function injectBase(html: string, base: string): string {
  const baseTag = `<base href="${base}">`
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

// Staging preview: always serves the latest draft (pages)
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

  if (error || !data) return errorPage(404, '404', 'Sito non trovato')

  const config = data.site_config as SiteConfig
  let pageHtml: string | undefined

  if (config?.pages && config.pages.length > 0) {
    const page = config.pages.find(p => p.slug === pageSlug)
    if (!page) return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste in questo sito.`)
    pageHtml = page.html
  } else if (pageSlug === 'home' && config?.html) {
    pageHtml = config.html
  }

  if (!pageHtml) return errorPage(200, data.name, 'Il sito non è ancora stato generato.')

  return new Response(injectBase(pageHtml, `/preview/${projectSlug}/`), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  })
}

// Production: serves published_pages only (set when user clicks "Pubblica")
export async function servePublished(projectSlug: string, pageSlug: string = 'home', customDomain: string) {
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

  if (error || !data) return errorPage(404, '404', 'Sito non trovato')

  const config = data.site_config as SiteConfig

  if (!config?.published_pages || config.published_pages.length === 0) {
    return errorPage(200, data.name, 'Il sito non è ancora stato pubblicato.')
  }

  const page = config.published_pages.find(p => p.slug === pageSlug)
  if (!page) return errorPage(404, '404', `La pagina "/${pageSlug}" non esiste.`)

  return new Response(injectBase(page.html, `https://${customDomain}/`), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' },
  })
}
