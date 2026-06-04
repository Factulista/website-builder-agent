import { createClient } from '@supabase/supabase-js'
import { buildBlogPostPage, type Post, type InjectPoints } from '../../../../../lib/blog-serve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  return m?.[1]?.slice(0, 2) ?? 'it'
}

// NOTE: this route handles `/preview/{slug}/blog/{X}` where X is treated as the POST slug.
// The param is named `category` to share the dynamic segment with the deeper
// `[category]/[postSlug]/route.ts` (Next.js requires identical param names at the same level).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; category: string }> }) {
  const { slug, category: postSlug } = await params
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
  const siteNav = (typeof config.shared_nav_html === 'string' && config.shared_nav_html)
    ? config.shared_nav_html
    : (homePage ? extractNav(homePage.html) : '')
  const siteFooter = (typeof config.shared_footer_html === 'string' && config.shared_footer_html)
    ? config.shared_footer_html
    : (homePage ? extractFooter(homePage.html) : '')
  const sharedCss = typeof config.shared_css === 'string' ? config.shared_css : null
  const fontLinks = (homePage?.html ?? '').match(/<link[^>]*(googleapis\.com|gstatic\.com)[^>]*>/gi)?.join('\n') ?? ''

  // Split shared_css into base styles and DS block.
  // DS block must come AFTER BLOG_POST_CONTENT_CSS so DS font-size/weight rules
  // win over blog defaults (source order matters at equal specificity).
  const DS_START = '/* fact-design-system:start */'
  const DS_END   = '/* fact-design-system:end */'
  let baseCss = sharedCss ?? ''
  let dsBlock = ''
  if (sharedCss) {
    const dsStartIdx = sharedCss.indexOf(DS_START)
    const dsEndIdx   = sharedCss.indexOf(DS_END)
    if (dsStartIdx !== -1 && dsEndIdx !== -1) {
      // Extract @import lines (must stay first) + DS block separately
      const dsContent = sharedCss.slice(dsStartIdx, dsEndIdx + DS_END.length)
      baseCss = sharedCss.replace(dsContent, '').replace(/@import[^;]+;/gi, '').trim()
      const dsImports = (sharedCss.match(/@import[^;]+;/gi) ?? []).join('\n')
      // Strip :where() global rules — they bleed into footer/nav.
      // Blog only needs the scoped .blog-post-content X rules.
      const scopedOnly = dsContent
        .split('\n')
        .filter(l => !l.trim().startsWith(':where('))
        .join('\n')
      dsBlock = `<style>${dsImports}
${scopedOnly}</style>`
    }
  }
  const siteStyle = baseCss
    ? `${fontLinks}\n<style>${baseCss}</style>`
    : (homePage ? `${fontLinks}\n${extractStyles(homePage.html)}` : '')

  const { data: post } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, published_at, categories, tags, content_html, seo_title, seo_description, author')
    .eq('project_id', project.id)
    .eq('slug', postSlug)
    .single()

  if (!post) return new Response('Post not found', { status: 404 })

  const sidebarBanner = (config.blog_sidebar_banner as { url: string; link: string } | undefined) ?? null
  const injectPoints = (config.inject_points as InjectPoints | undefined)
  const faviconUrl = typeof config.favicon_url === 'string' ? config.favicon_url : undefined
  const originalHost = _req.headers.get('x-original-host')
  const baseUrl = originalHost ? `https://${originalHost}` : `/preview/${slug}`
  const html = buildBlogPostPage(post as Post, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner, faviconUrl, injectPoints, dsBlock)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
