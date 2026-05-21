import { createClient } from '@supabase/supabase-js'
import { buildBlogListPage, type Post } from '../../../../lib/blog-serve'

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
/** Detect language: context.language → <html lang="..."> → 'it' */
function detectLang(context: Record<string, unknown>, homeHtml: string): string {
  if (typeof context.language === 'string' && context.language) return context.language
  const m = homeHtml.match(/<html[^>]+lang=["']([^"']+)["']/i)
  return m?.[1]?.slice(0, 2) ?? 'it'
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
  const pages = (config.pages as Array<{ slug: string; html: string }> | undefined) ?? []
  const context = (config.context ?? {}) as Record<string, unknown>
  const homePage = pages.find(p => p.slug === 'home')
  const lang = detectLang(context, homePage?.html ?? '')
  const siteNav = homePage ? extractNav(homePage.html) : ''
  const siteFooter = homePage ? extractFooter(homePage.html) : ''
  const siteStyle = homePage ? extractStyles(homePage.html) : ''

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, published_at, categories, tags, content_html, seo_title, seo_description, author')
    .eq('project_id', project.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const baseUrl = `/preview/${slug}`
  const html = buildBlogListPage((posts ?? []) as Post[], baseUrl, siteNav, siteFooter, siteStyle, lang)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
