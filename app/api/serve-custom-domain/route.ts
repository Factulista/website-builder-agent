import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { servePublished } from '../../../lib/preview'
import { generateSitemap, generateRobots, generateLlmsTxt, generateLlmsFullTxt } from '../../../lib/seo-files'
import { buildBlogPostPage as buildBlogPostPageFromLib, buildBlogListPage as buildBlogListPageFromLib, type Post as LibPost, type BlogSidebarBanner, type InjectPoints, escapeHtml, safeUrl, slugifySimple } from '../../../lib/blog-serve'
import { buildBlogDsBlock, stripDesignSystemBlocks, type DesignSystem } from '../../../lib/design-system'
import { buildAyudaHubPage, buildAyudaCategoryPage, buildAyudaArticlePage, type SupportArticle as SupportArticleType } from '../../../lib/support-serve'

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
  const seoKeywords = (siteConfig.keywords as Array<{keyword:string}>)?.map(k => k.keyword) ?? []
  const siteContext = (siteConfig.context ?? {}) as Record<string, string>
  const lang = siteContext.language ?? 'it'

  // Serve sitemap.xml — include blog posts + support articles
  if (pathname === '/sitemap.xml') {
    const { data: blogPosts } = await supabase
      .from('blog_posts')
      .select('slug, published_at')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
    const { data: supportArticlesForSitemap } = await supabase
      .from('support_articles')
      .select('slug, category, published_at')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })

    const xml = generateSitemap(publishedPages, baseUrl, undefined, blogPosts ?? [], supportArticlesForSitemap ?? [])
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  // Serve robots.txt
  if (pathname === '/robots.txt') {
    return new Response(generateRobots(baseUrl, publishedPages), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  // Serve llms.txt / llms-full.txt — AI assistant summary (llmstxt.org standard)
  if (pathname === '/llms.txt' || pathname === '/llms-full.txt') {
    const isFull = pathname === '/llms-full.txt'
    const { data: blogPostsForLlms } = await supabase
      .from('blog_posts')
      .select(isFull ? 'slug, title, published_at, seo_description, content_html' : 'slug, title, published_at, seo_description')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(isFull ? 30 : 20)
    const { data: supportArticlesForLlms } = await supabase
      .from('support_articles')
      .select(isFull ? 'slug, title, category, published_at, seo_description, excerpt, content_html' : 'slug, title, category, published_at, seo_description, excerpt')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(isFull ? 30 : 20)
    const siteName = (siteConfig.siteName as string) || host
    const siteDesc = (siteConfig.siteDescription as string) || undefined
    const llmsIntro = (siteConfig.llmsIntroduction as string) || undefined
    const body = isFull
      ? generateLlmsFullTxt(publishedPages, baseUrl, siteName, siteDesc, (blogPostsForLlms as any[]) ?? [], llmsIntro, (supportArticlesForLlms as any[]) ?? [])
      : generateLlmsTxt(publishedPages, baseUrl, siteName, siteDesc, (blogPostsForLlms as any[]) ?? [], llmsIntro, (supportArticlesForLlms as any[]) ?? [])
    return new Response(body, {
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

  const PAGE_SIZE = 15

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
    // Strip ALL DS blocks from baseCss (global). Authoritative block from designSystem.
    const baseCssForBlog = sharedCss ? stripDesignSystemBlocks(sharedCss) : ''
    const blogDesignSystem = siteConfig.designSystem as DesignSystem | undefined
    let dsOverrideBlock = ''
    if (blogDesignSystem) {
      dsOverrideBlock = buildBlogDsBlock(blogDesignSystem)
    } else if (sharedCss) {
      const DS_START = '/* fact-design-system:start */'
      const DS_END   = '/* fact-design-system:end */'
      const dsStartIdx = sharedCss.indexOf(DS_START)
      const dsEndIdx   = sharedCss.indexOf(DS_END)
      if (dsStartIdx !== -1 && dsEndIdx !== -1) {
        const dsContent = sharedCss.slice(dsStartIdx, dsEndIdx + DS_END.length)
        const scopedOnly = dsContent.split('\n').filter(l => !l.trim().startsWith(':where(')).join('\n')
        dsOverrideBlock = `<style>${scopedOnly}</style>`
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
      const megaPages = publishedPages.filter((p: Record<string, unknown>) => !!p.megaMenu).map((p: Record<string, unknown>) => ({ slug: p.slug as string, name: p.name as string, menuLabel: p.menuLabel as string | undefined, megaMenuLabel: p.megaMenuLabel as string | undefined, megaMenuIcon: p.megaMenuIcon as string | undefined, megaMenu: p.megaMenu as string | undefined }))
      const blogSeoTitle = typeof siteConfig.blog_seo_title === 'string' ? siteConfig.blog_seo_title : undefined
      const blogSeoDescription = typeof siteConfig.blog_seo_description === 'string' ? siteConfig.blog_seo_description : undefined
      const html = buildBlogListPageFromLib(posts ?? [], baseUrl, siteNav, siteFooter, siteStyle, lang, headerHtml, currentPage, totalPages, faviconUrl, injectPoints, megaPages, blogSeoTitle, blogSeoDescription)
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
      const megaPagesBlogPost = publishedPages.filter((p: Record<string, unknown>) => !!p.megaMenu).map((p: Record<string, unknown>) => ({ slug: p.slug as string, name: p.name as string, menuLabel: p.menuLabel as string | undefined, megaMenuLabel: p.megaMenuLabel as string | undefined, megaMenuIcon: p.megaMenuIcon as string | undefined, megaMenu: p.megaMenu as string | undefined }))
      const html = buildBlogPostPageFromLib(post as LibPost, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner, faviconUrl, injectPoints, dsOverrideBlock, megaPagesBlogPost)
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400' },
      })
    }
  }

  // ── Ayuda (support center) routes ───────────────────────────────────────────
  const isAyudaPath = pathname === '/ayuda' || pathname === '/ayuda/' || pathname.startsWith('/ayuda/')
  if (isAyudaPath) {
    const homePage = publishedPages.find(p => p.slug === 'home')
    const siteNav = (typeof siteConfig.shared_nav_html === 'string' && siteConfig.shared_nav_html)
      ? siteConfig.shared_nav_html
      : (homePage ? extractNav(homePage.html) : '')
    const siteFooter = (typeof siteConfig.shared_footer_html === 'string' && siteConfig.shared_footer_html)
      ? siteConfig.shared_footer_html
      : (homePage ? extractFooter(homePage.html) : '')
    const sharedCss = typeof siteConfig.shared_css === 'string' ? siteConfig.shared_css : null
    const fontLinks = (homePage?.html ?? '').match(/<link[^>]*(googleapis\.com|gstatic\.com)[^>]*>/gi)?.join('\n') ?? ''
    const siteStyle = sharedCss ? `${fontLinks}\n<style>${sharedCss}</style>` : (homePage ? `${fontLinks}\n${extractStyles(homePage.html)}` : '')
    const faviconUrl = (siteConfig.favicon_url as string | undefined)
    const megaPagesAyuda = publishedPages.filter((p: Record<string, unknown>) => !!p.megaMenu).map((p: Record<string, unknown>) => ({ slug: p.slug as string, name: p.name as string, menuLabel: p.menuLabel as string | undefined, megaMenuLabel: p.megaMenuLabel as string | undefined, megaMenuIcon: p.megaMenuIcon as string | undefined, megaMenu: p.megaMenu as string | undefined }))

    const segments = pathname.replace(/^\/ayuda\/?/, '').split('/').filter(Boolean)

    if (segments.length === 0) {
      // /ayuda → hub (search + category tiles)
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
      const categories = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
      const seoTitle = typeof siteConfig.ayuda_seo_title === 'string' ? siteConfig.ayuda_seo_title : undefined
      const seoDescription = typeof siteConfig.ayuda_seo_description === 'string' ? siteConfig.ayuda_seo_description : undefined
      const html = buildAyudaHubPage(project.id, categories, baseUrl, siteNav, siteFooter, siteStyle, lang, faviconUrl, megaPagesAyuda, seoTitle, seoDescription)
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } })
    }

    if (segments.length === 1) {
      // /ayuda/{category} → category listing
      const categorySlug = segments[0]
      const { data: allPublished } = await supabase
        .from('support_articles')
        .select('id, title, slug, excerpt, category, tags, published_at, content_html, seo_title, seo_description, author')
        .eq('project_id', project.id)
        .eq('status', 'published')
      const category = (allPublished ?? []).find(a => slugifySimple(a.category || '') === categorySlug)?.category
      if (!category) {
        return new Response('Category not found', { status: 404 })
      }
      const catArticles = (allPublished ?? []).filter(a => a.category === category) as unknown as SupportArticleType[]
      const html = buildAyudaCategoryPage(catArticles, category, baseUrl, siteNav, siteFooter, siteStyle, lang, faviconUrl, megaPagesAyuda)
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } })
    }

    // /ayuda/{category}/{slug} → article detail
    const articleSlug = segments[segments.length - 1]
    const { data: article } = await supabase
      .from('support_articles')
      .select('id, title, slug, excerpt, category, tags, published_at, content_html, seo_title, seo_description, author, related_article_ids')
      .eq('project_id', project.id)
      .eq('slug', articleSlug)
      .eq('status', 'published')
      .single()
    if (!article) {
      return new Response(
        '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;text-align:center;"><h1>404</h1><p>Artículo no encontrado.</p><a href="/ayuda">← Ayuda</a></body></html>',
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }
    const { data: relCandidates } = await supabase
      .from('support_articles')
      .select('id, title, slug, excerpt, category, tags, published_at, content_html, seo_title, seo_description, author')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(40)
    const manualIds = (article.related_article_ids as string[] | undefined) ?? []
    const pool = (relCandidates ?? []).filter(a => a.id !== article.id) as unknown as SupportArticleType[]
    let relatedArticles: SupportArticleType[]
    if (manualIds.length > 0) {
      const byId = new Map(pool.map(a => [a.id, a]))
      relatedArticles = manualIds.map(id => byId.get(id)).filter((a): a is SupportArticleType => !!a).slice(0, 3)
    } else {
      relatedArticles = pool.filter(a => a.category === article.category).slice(0, 3)
    }
    const html = buildAyudaArticlePage(article as unknown as SupportArticleType, relatedArticles, baseUrl, siteNav, siteFooter, siteStyle, lang, faviconUrl, megaPagesAyuda)
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400' } })
  }

  // ── Regular site pages ─────────────────────────────────────────────────────
  const pageSlug = pathname === '' || pathname === '/' ? 'home' : pathname.slice(1)
  return servePublished(project.slug, pageSlug, host)
}
