import { createClient } from '@supabase/supabase-js'
import { buildBlogListPage, type Post, type InjectPoints } from '../../../../lib/blog-serve'

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

const PAGE_SIZE = 16

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = getSupabase()

  const url = new URL(_req.url)
  const currentPage = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const offset = (currentPage - 1) * PAGE_SIZE

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
  const siteNav = (typeof config.shared_nav_html === 'string' && config.shared_nav_html)
    ? config.shared_nav_html
    : (homePage ? extractNav(homePage.html) : '')
  const siteFooter = (typeof config.shared_footer_html === 'string' && config.shared_footer_html)
    ? config.shared_footer_html
    : (homePage ? extractFooter(homePage.html) : '')
  const sharedCss = typeof config.shared_css === 'string' ? config.shared_css : null
  const fontLinks = (homePage?.html ?? '').match(/<link[^>]*(googleapis\.com|gstatic\.com)[^>]*>/gi)?.join('\n') ?? ''
  const siteStyle = sharedCss ? `${fontLinks}\n<style>${sharedCss}</style>` : (homePage ? `${fontLinks}\n${extractStyles(homePage.html)}` : '')
  const headerHtml = (config.blog_header_html as string) ?? ''
  const injectPoints = (config.inject_points as InjectPoints | undefined)

  const { data: posts, count } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, published_at, categories, tags, content_html, seo_title, seo_description, author', { count: 'exact' })
    .eq('project_id', project.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1
  const baseUrl = `/preview/${slug}`
  const html = buildBlogListPage((posts ?? []) as Post[], baseUrl, siteNav, siteFooter, siteStyle, lang, headerHtml, currentPage, totalPages, undefined, injectPoints)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
