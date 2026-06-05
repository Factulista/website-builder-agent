import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { servePublished } from '../../../lib/preview'
import { generateSitemap, generateRobots } from '../../../lib/seo-files'
import { buildBlogPostPage as buildBlogPostPageFromLib, buildBlogListPage as buildBlogListPageFromLib, type Post as LibPost, type BlogSidebarBanner, type InjectPoints, escapeHtml, safeUrl } from '../../../lib/blog-serve'
import { buildBlogDsBlock, type DesignSystem } from '../../../lib/design-system'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Extract first <nav>...</nav> from HTML */
function extractNav(html: string): string {
  const m = html.match(/<nav[\s\S]*?<\/nav>/i)
  return m?.[0] ?? ''
}

/** Extract last <footer>...</footer> from HTML */
function extractFooter(html: string): string {
  const matches = [...html.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
  return matches.length > 0 ? matches[matches.length - 1][0] : ''
}

/** Extract all <style>...</style> blocks from HTML */
function extractStyles(html: string): string {
  return (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n')
}

export async function GET(req: NextRequest) {
  const host = req.nextUrl.searchParams.get('host')

  if (!host) {
    return new Response('Invalid request', { status: 400 })
  }

  let pathname = req.nextUrl.pathname
  pathname = pathname.replace(/^\/api\/serve-custom-domain/, '')

  const supabase = getSupabase()

  // Find project by custom domain
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, slug, site_config, custom_domain_status')
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

  const baseUrl = `https://${host}`
  const siteConfig = (project.site_config ?? {}) as Record<string, unknown>
  const publishedPages = (siteConfig.published_pages as Array<{ slug: string; name: string; html: string }>) ?? []
  const siteContext = (siteConfig.context ?? {}) as Record<string, string>
  const lang = siteContext.language ?? 'it'

  // Serve sitemap.xml — include blog posts
  if (pathname === '/sitemap.xml') {
    const { data: blogPosts } = await supabase
      .from('blog_posts')
      .select('slug, published_at')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    const xml = generateSitemap(publishedPages, baseUrl, undefined, blogPosts ?? [])
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  // Serve robots.txt
  if (pathname === '/robots.txt') {
    return new Response(generateRobots(baseUrl), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  // Serve RSS feed
  if (pathname === '/blog/feed.xml' || pathname === '/feed.xml') {
    const { data: blogPosts } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, published_at, categories')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)

    // XML-safe: CDATA can't contain "]]>"; replace it. Element content needs escape.
    const cdata = (s: string) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
    const xmlEsc = (s: string) => escapeHtml(s)
    const items = (blogPosts ?? []).map(p => `  <item>
    <title>${cdata(p.title)}</title>
    <link>${xmlEsc(baseUrl)}/blog/${xmlEsc(p.slug)}</link>
    <guid isPermaLink="true">${xmlEsc(baseUrl)}/blog/${xmlEsc(p.slug)}</guid>
    <pubDate>${p.published_at ? new Date(p.published_at).toUTCString() : ''}</pubDate>
    <description>${cdata(p.excerpt ?? '')}</description>
    ${(p.categories ?? []).map((c: string) => `<category>${xmlEsc(c)}</category>`).join('\n    ')}
  </item>`).join('\n')

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog — ${xmlEsc(host)}</title>
    <link>${xmlEsc(baseUrl)}/blog</link>
    <atom:link href="${xmlEsc(baseUrl)}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Blog feed</description>
    <language>${xmlEsc(lang)}</language>
${items}
  </channel>
</rss>`

    return new Response(rss, {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
    })
  }

  const PAGE_SIZE = 16

  // ── Blog routes ────────────────────────────────────────────────────────────
  const isBlogPath = pathname === '/blog' || pathname === '/blog/' || pathname.startsWith('/blog/')

  if (isBlogPath) {
    // Get site design from home page
    const homePage = publishedPages.find(p => p.slug === 'home')
    const siteNav = (typeof siteConfig.shared_nav_html === 'string' && siteConfig.shared_nav_html)
      ? siteConfig.shared_nav_html
      : (homePage ? extractNav(homePage.html) : '')
    const siteFooter = (typeof siteConfig.shared_footer_html === 'string' && siteConfig.shared_footer_html)
      ? siteConfig.shared_footer_html
      : (homePage ? extractFooter(homePage.html) : '')
    const sharedCss = typeof siteConfig.shared_css === 'string' ? siteConfig.shared_css : null
    const fontLinks = (homePage?.html ?? '').match(/<link[^>]*(googleapis\.com|gstatic\.com)[^>]*>/gi)?.join('\n') ?? ''

    // Design System: site_config.designSystem is the AUTHORITATIVE source.
    // Build the DS override block directly from it (not by parsing shared_css)
    // so the blog typography always matches the DS panel. Injected AFTER
    // BLOG_POST_CONTENT_CSS so it wins by source order.
    const DS_START = '/* fact-design-system:start */'
    const DS_END   = '/* fact-design-system:end */'
    let baseCssForBlog = sharedCss ?? ''
    if (sharedCss) {
      const dsStartIdx = sharedCss.indexOf(DS_START)
      const dsEndIdx   = sharedCss.indexOf(DS_END)
      if (dsStartIdx !== -1 && dsEndIdx !== -1) {
        const dsContent = sharedCss.slice(dsStartIdx, dsEndIdx + DS_END.length)
        baseCssForBlog = sharedCss.replace(dsContent, '').replace(/@import[^;]+;/gi, '').trim()
      }
    }
    const blogDesignSystem = siteConfig.designSystem as DesignSystem | undefined
    let dsOverrideBlock = ''
    if (blogDesignSystem) {
      dsOverrideBlock = buildBlogDsBlock(blogDesignSystem)
    } else if (sharedCss) {
      const dsStartIdx = sharedCss.indexOf(DS_START)
      const dsEndIdx   = sharedCss.indexOf(DS_END)
      if (dsStartIdx !== -1 && dsEndIdx !== -1) {
        const dsContent = sharedCss.slice(dsStartIdx, dsEndIdx + DS_END.length)
        const rawImports = sharedCss.match(/@import url\(['"][^'"]+['"]\)[^;]*;/gi) ?? []
        const asyncFontLinks = rawImports.map(i => {
          const url = i.match(/@import url\(['"]([^'"]+)['"]\)/i)?.[1] ?? ''
          return url ? `<link rel="stylesheet" href="${url}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${url}"></noscript>` : ''
        }).filter(Boolean).join('\n')
        const scopedOnly = dsContent.split('\n').filter(l => !l.trim().startsWith(':where(')).join('\n')
        dsOverrideBlock = `${asyncFontLinks}\n<style>${scopedOnly}</style>`
      }
    }
    const siteStyle = baseCssForBlog ? `${fontLinks}\n<style>${baseCssForBlog}</style>` : (homePage ? `${fontLinks}\n${extractStyles(homePage.html)}` : '')

    // /blog or /blog/ → listing
    if (pathname === '/blog' || pathname === '/blog/') {
      // Check if there's a manually created blog listing page
      const customBlogPage = publishedPages.find(p => p.slug === 'blog')
      if (customBlogPage) {
        return new Response(customBlogPage.html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400' },
        })
      }

      const currentPage = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10))
      const offset = (currentPage - 1) * PAGE_SIZE
      const headerHtml = (siteConfig.blog_header_html as string) ?? ''

      // Dynamic listing from DB
      const { data: posts, count } = await supabase
        .from('blog_posts')
        .select('id, title, slug, excerpt, featured_image, published_at, categories, tags, content_html, seo_title, seo_description', { count: 'exact' })
        .eq('project_id', project.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1
      const faviconUrl = (siteConfig.favicon_url as string | undefined)
      const injectPoints = (siteConfig.inject_points as InjectPoints | undefined)
      const html = buildBlogListPageFromLib(posts ?? [], baseUrl, siteNav, siteFooter, siteStyle, lang, headerHtml, currentPage, totalPages, faviconUrl, injectPoints)
      return new Response(html, {
        status: 200,
        // Blog listing: shorter CDN TTL (new posts appear here)
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
      })
    }

    // /blog/[slug] → single post
    const postSlug = pathname.replace(/^\/blog\//, '')
    if (postSlug) {
      const { data: post } = await supabase
        .from('blog_posts')
        .select('id, title, slug, excerpt, featured_image, published_at, categories, tags, content_html, seo_title, seo_description')
        .eq('project_id', project.id)
        .eq('slug', postSlug)
        .eq('status', 'published')
        .single()

      if (!post) {
        return new Response(
          '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;"><h1>404</h1><p>Articolo non trovato.</p><a href="/blog">← Blog</a></body></html>',
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      }

      const sidebarBanner = (siteConfig.blog_sidebar_banner as BlogSidebarBanner | undefined) ?? null
      const faviconUrl = (siteConfig.favicon_url as string | undefined)
      const injectPoints = (siteConfig.inject_points as InjectPoints | undefined)
      const html = buildBlogPostPageFromLib(post as LibPost, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner, faviconUrl, injectPoints, dsOverrideBlock)
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400' },
      })
    }
  }

  // ── Regular site pages ─────────────────────────────────────────────────────
  const pageSlug = pathname === '' || pathname === '/' ? 'home' : pathname.slice(1)
  return servePublished(project.slug, pageSlug, host)
}
