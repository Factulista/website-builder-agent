import { createClient } from '@supabase/supabase-js'
import { buildBlogPostPage, type Post, type InjectPoints } from '../../../../../../lib/blog-serve'
import { buildBlogDsBlock, stripDesignSystemBlocks, type DesignSystem } from '../../../../../../lib/design-system'

export const runtime = 'nodejs'
// No 'force-dynamic': route is dynamic (params + DB) but the explicit Cache-Control
// (s-maxage + SWR) on the Response must be honored by the CDN for fast TTFB.

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function extractNav(html: string) { return html.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? '' }
function extractFooter(html: string) {
  const m = [...html.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
  return m.length > 0 ? m[m.length - 1][0] : ''
}
function extractStyles(html: string) { return (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n') }

function splitCriticalCss(css: string): { critical: string; deferred: string } {
  const CRITICAL_PATTERNS = [
    /^:root\s*\{/, /^\*\s*[\{,]/, /^html\s*[\{,]/, /^body\s*[\{,]/,
    /nav/i, /footer/i, /\.header/i, /^header/i, /--[a-z]/, /^@/,
  ]
  const lines = css.split('\n')
  const critical: string[] = []
  const deferred: string[] = []
  let depth = 0, blockLines: string[] = [], isCritical = false
  for (const line of lines) {
    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    if (depth === 0 && opens > 0) {
      isCritical = CRITICAL_PATTERNS.some(p => p.test(line.trim()))
      blockLines = []
    }
    blockLines.push(line)
    depth += opens - closes
    if (depth <= 0) {
      depth = 0
      ;(isCritical ? critical : deferred).push(...blockLines)
      blockLines = []
    }
  }
  if (blockLines.length) critical.push(...blockLines)
  return { critical: critical.join('\n'), deferred: deferred.join('\n') }
}
function detectLang(context: Record<string, unknown>, homeHtml: string): string {
  if (typeof context.language === 'string' && context.language) return context.language
  const m = homeHtml.match(/<html[^>]+lang=["']([^"']+)["']/i)
  return m?.[1]?.slice(0, 2) ?? 'it'
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; category: string; postSlug: string }> }) {
  const { slug, postSlug } = await params
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
  // Strip ALL DS blocks from baseCss (global). Authoritative DS block is built
  // from config.designSystem so the blog always matches the panel.
  const baseCss = sharedCss ? stripDesignSystemBlocks(sharedCss) : ''
  const designSystem = config.designSystem as DesignSystem | undefined
  let dsBlock = ''
  if (designSystem) {
    dsBlock = buildBlogDsBlock(designSystem)
  } else if (sharedCss) {
    const DS_START = '/* fact-design-system:start */'
    const DS_END   = '/* fact-design-system:end */'
    const dsStartIdx = sharedCss.indexOf(DS_START)
    const dsEndIdx   = sharedCss.indexOf(DS_END)
    if (dsStartIdx !== -1 && dsEndIdx !== -1) {
      const dsContent = sharedCss.slice(dsStartIdx, dsEndIdx + DS_END.length)
      const scopedOnly = dsContent.split('\n').filter(l => !l.trim().startsWith(':where(')).join('\n')
      dsBlock = `<style>${scopedOnly}</style>`
    }
  }
  const rawSiteCss = baseCss || (homePage
    ? (homePage.html.match(/<style[\s\S]*?<\/style>/gi) ?? []).map((s: string) => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
    : '')
  const { critical: criticalCss, deferred: deferredCss } = splitCriticalCss(rawSiteCss)
  const deferredBlock = deferredCss.trim()
    ? `<script>window.addEventListener('load',function(){var s=document.createElement('style');s.textContent=${JSON.stringify(deferredCss)};document.head.appendChild(s)});</script>`
    : ''
  const siteStyle = `${fontLinks}\n<style>${criticalCss}</style>${deferredBlock}`

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
  const megaPages = pages.filter(p => p.megaMenu === 'funcionalidades').map(p => ({ slug: p.slug as string, name: p.name as string, menuLabel: p.menuLabel as string | undefined, megaMenuLabel: p.megaMenuLabel as string | undefined, megaMenuIcon: p.megaMenuIcon as string | undefined }))
  const html = buildBlogPostPage(post as Post, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner, faviconUrl, injectPoints, dsBlock, megaPages)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400' } })
}
