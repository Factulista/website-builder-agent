import { createClient } from '@supabase/supabase-js'
import { buildAyudaHubPage, type SupportCategory } from '../../../../lib/support-serve'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function extractNav(html: string) { return html.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? '' }
function extractFooter(html: string) {
  const m = [...html.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
  return m.length > 0 ? m[m.length - 1][0] : ''
}
function extractStyles(html: string) { return (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n') }
function detectLang(context: Record<string, unknown>, homeHtml: string): string {
  if (typeof context.language === 'string' && context.language) return context.language
  const m = homeHtml.match(/<html[^>]+lang=["']([^"']+)["']/i)
  return m?.[1]?.slice(0, 2) ?? 'es'
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = getSupabase()

  const { data: project } = await supabase
    .from('projects')
    .select('id, site_config')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single()

  if (!project) return new Response('Not found', { status: 404 })

  const config = (project.site_config ?? {}) as Record<string, unknown>
  const pages = (config.pages as Array<Record<string, unknown> & { slug: string; html: string }> | undefined) ?? []
  const context = (config.context ?? {}) as Record<string, unknown>
  const homePage = pages.find(p => p.slug === 'home')
  const lang = detectLang(context, homePage?.html ?? '')
  const siteNav = (typeof config.shared_nav_html === 'string' && config.shared_nav_html)
    ? config.shared_nav_html
    : (homePage ? extractNav(homePage.html) : '')
  const siteFooter = (typeof config.shared_footer_html === 'string' && config.shared_footer_html)
    ? config.shared_footer_html
    : (homePage ? extractFooter(homePage.html) : '')
  const sharedCss = typeof config.shared_css === 'string' ? config.shared_css : null
  const fontLinks = (homePage?.html ?? '').match(/<link[^>]*(googleapis\.com|gstatic\.com)[^>]*>/gi)?.join('\n') ?? ''
  const siteStyle = sharedCss ? `${fontLinks}\n<style>${sharedCss}</style>` : (homePage ? `${fontLinks}\n${extractStyles(homePage.html)}` : '')
  const faviconUrl = typeof config.favicon_url === 'string' ? config.favicon_url : undefined

  const { data: articles } = await supabase
    .from('support_articles')
    .select('category')
    .eq('project_id', project.id)
    .eq('status', 'published')

  const counts = new Map<string, number>()
  for (const a of articles ?? []) {
    const cat = (a.category as string) || 'General'
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  const categories: SupportCategory[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const originalHost = _req.headers.get('x-original-host')
  const baseUrl = originalHost ? `https://${originalHost}` : `/preview/${slug}`
  const megaPages = pages.filter(p => !!p.megaMenu).map(p => ({ slug: p.slug as string, name: p.name as string, menuLabel: p.menuLabel as string | undefined, megaMenuLabel: p.megaMenuLabel as string | undefined, megaMenuIcon: p.megaMenuIcon as string | undefined, megaMenu: p.megaMenu as string | undefined }))
  const seoTitle = typeof config.ayuda_seo_title === 'string' ? config.ayuda_seo_title : undefined
  const seoDescription = typeof config.ayuda_seo_description === 'string' ? config.ayuda_seo_description : undefined

  const html = buildAyudaHubPage(project.id, categories, baseUrl, siteNav, siteFooter, siteStyle, lang, faviconUrl, megaPages, seoTitle, seoDescription)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400' } })
}
