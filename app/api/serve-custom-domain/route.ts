import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { servePublished } from '../../../lib/preview'
import { generateSitemap, generateRobots } from '../../../lib/seo-files'
import { buildBlogPostPage as buildBlogPostPageFromLib, type Post as LibPost, type BlogSidebarBanner } from '../../../lib/blog-serve'

export const runtime = 'nodejs'

type Post = {
  id: string
  title: string
  slug: string
  excerpt: string
  featured_image: string | null
  published_at: string | null
  categories: string[]
  tags: string[]
  content_html: string
  seo_title: string | null
  seo_description: string | null
}

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

function formatDate(iso: string | null, lang = 'it'): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'it-IT', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return '' }
}

function buildBlogListPage(
  posts: Post[],
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'it',
  headerHtml = '',
  currentPage = 1,
  totalPages = 1,
  faviconUrl?: string
): string {
  const title = lang === 'es' ? 'Blog' : lang === 'en' ? 'Blog' : 'Blog'
  const subtitle = lang === 'es' ? 'Artículos y novedades' : lang === 'en' ? 'Articles and updates' : 'Articoli e aggiornamenti'
  const readMoreLabel = lang === 'es' ? 'Leer más →' : lang === 'en' ? 'Read more →' : 'Leggi →'

  const cards = posts.map(post => {
    const img = post.featured_image
      ? `<img class="blog-card-img" src="${post.featured_image}" alt="${post.title}" loading="lazy">`
      : ''
    const tags = (post.categories ?? []).slice(0, 3).map(c =>
      `<span class="blog-tag">${c}</span>`
    ).join('')
    const dateStr = formatDate(post.published_at, lang)

    return `<article class="blog-card">
  ${img}
  <div class="blog-card-body">
    <div class="blog-card-meta">${dateStr}${tags ? ` &nbsp;${tags}` : ''}</div>
    <h2 class="blog-card-title"><a href="${baseUrl}/blog/${post.slug}">${post.title}</a></h2>
    ${post.excerpt ? `<p class="blog-card-excerpt">${post.excerpt}</p>` : ''}
    <a class="blog-read-more" href="${baseUrl}/blog/${post.slug}">${readMoreLabel}</a>
  </div>
</article>`
  }).join('\n')

  const emptyState = posts.length === 0
    ? `<p style="color:#888;text-align:center;padding:3rem 0;">${lang === 'es' ? 'No hay artículos publicados aún.' : lang === 'en' ? 'No articles published yet.' : 'Nessun articolo pubblicato ancora.'}</p>`
    : ''

  const headerSection = headerHtml ? `<div class="blog-header-custom">${headerHtml}</div>` : ''

  // Build pagination HTML
  let paginationHtml = ''
  if (totalPages > 1) {
    const pageHref = (n: number) => n === 1 ? `${baseUrl}/blog` : `${baseUrl}/blog?page=${n}`
    const prevDisabled = currentPage <= 1
    const nextDisabled = currentPage >= totalPages

    const pageLinks: string[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pageLinks.push(`<a class="blog-page-link${i === currentPage ? ' active' : ''}" href="${pageHref(i)}">${i}</a>`)
      }
    } else {
      const pages: (number | '...')[] = []
      pages.push(1)
      if (currentPage > 3) pages.push('...')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i)
      }
      if (currentPage < totalPages - 2) pages.push('...')
      pages.push(totalPages)
      for (const p of pages) {
        if (p === '...') {
          pageLinks.push(`<span class="blog-page-link disabled">…</span>`)
        } else {
          pageLinks.push(`<a class="blog-page-link${p === currentPage ? ' active' : ''}" href="${pageHref(p)}">${p}</a>`)
        }
      }
    }

    paginationHtml = `<nav class="blog-pagination" aria-label="Pagination">
  <a class="blog-page-link${prevDisabled ? ' disabled' : ''}" href="${prevDisabled ? '#' : pageHref(currentPage - 1)}" ${prevDisabled ? 'aria-disabled="true"' : ''}>&#8592;</a>
  ${pageLinks.join('\n  ')}
  <a class="blog-page-link${nextDisabled ? ' disabled' : ''}" href="${nextDisabled ? '#' : pageHref(currentPage + 1)}" ${nextDisabled ? 'aria-disabled="true"' : ''}>&#8594;</a>
</nav>`
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${subtitle}">
  <link rel="canonical" href="${baseUrl}/blog">
  ${faviconUrl ? `<link rel="icon" href="${faviconUrl}">` : ''}
  ${siteStyle}
  <style>
    .blog-listing { max-width: 1100px; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
    .blog-listing-header { margin-bottom: 2.5rem; }
    .blog-listing-header h1 { font-size: 2.4rem; font-weight: 800; margin: 0 0 0.4rem; }
    .blog-listing-header p { color: #666; margin: 0; font-size: 1.05rem; }
    .blog-grid { display: grid; gap: 1.5rem; }
    .blog-card { background: white; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden; transition: box-shadow 0.2s, transform 0.2s; }
    .blog-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.1); transform: translateY(-2px); }
    .blog-card-img { width: 100%; height: 200px; object-fit: cover; display: block; }
    .blog-card-body { padding: 1.25rem 1.4rem 1.4rem; }
    .blog-card-meta { font-size: 0.76rem; color: #888; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .blog-tag { background: #f3f4f6; color: #374151; font-size: 0.68rem; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
    .blog-card-title { font-size: 1.15rem; font-weight: 700; margin: 0 0 0.6rem; line-height: 1.35; }
    .blog-card-title a { color: inherit; text-decoration: none; }
    .blog-card-title a:hover { text-decoration: underline; }
    .blog-card-excerpt { font-size: 0.9rem; color: #555; margin: 0 0 1rem; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .blog-read-more { font-size: 0.85rem; font-weight: 600; color: var(--color-accent, #2563eb); text-decoration: none; }
    .blog-read-more:hover { text-decoration: underline; }
    @media (min-width: 640px) { .blog-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (min-width: 1024px) { .blog-grid { grid-template-columns: repeat(3, 1fr); } }
    .blog-pagination{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2.5rem;flex-wrap:wrap}
    .blog-page-link{display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;padding:0 10px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:.85rem;font-weight:500;text-decoration:none;transition:background .15s,border-color .15s}
    .blog-page-link:hover{background:#f3f4f6;border-color:#d1d5db}
    .blog-page-link.active{background:var(--color-accent,#2563eb);border-color:var(--color-accent,#2563eb);color:#fff;font-weight:700;pointer-events:none}
    .blog-page-link.disabled{opacity:.4;pointer-events:none}
  </style>
</head>
<body>
  ${siteNav}
  ${headerSection}
  <section class="blog-listing">
    <div class="blog-listing-header">
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </div>
    ${emptyState}
    <div class="blog-grid">
      ${cards}
    </div>
    ${paginationHtml}
  </section>
  ${siteFooter}
</body>
</html>`
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

    const items = (blogPosts ?? []).map(p => `  <item>
    <title><![CDATA[${p.title}]]></title>
    <link>${baseUrl}/blog/${p.slug}</link>
    <guid isPermaLink="true">${baseUrl}/blog/${p.slug}</guid>
    <pubDate>${p.published_at ? new Date(p.published_at).toUTCString() : ''}</pubDate>
    <description><![CDATA[${p.excerpt ?? ''}]]></description>
    ${(p.categories ?? []).map((c: string) => `<category>${c}</category>`).join('\n    ')}
  </item>`).join('\n')

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog — ${host}</title>
    <link>${baseUrl}/blog</link>
    <atom:link href="${baseUrl}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Blog feed</description>
    <language>${lang}</language>
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
    const siteNav = homePage ? extractNav(homePage.html) : ''
    const siteFooter = homePage ? extractFooter(homePage.html) : ''
    const siteStyle = homePage ? extractStyles(homePage.html) : ''

    // /blog or /blog/ → listing
    if (pathname === '/blog' || pathname === '/blog/') {
      // Check if there's a manually created blog listing page
      const customBlogPage = publishedPages.find(p => p.slug === 'blog')
      if (customBlogPage) {
        return new Response(customBlogPage.html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
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
      const html = buildBlogListPage(posts ?? [], baseUrl, siteNav, siteFooter, siteStyle, lang, headerHtml, currentPage, totalPages, faviconUrl)
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
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
      const html = buildBlogPostPageFromLib(post as LibPost, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner, faviconUrl)
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      })
    }
  }

  // ── Regular site pages ─────────────────────────────────────────────────────
  const pageSlug = pathname === '' || pathname === '/' ? 'home' : pathname.slice(1)
  return servePublished(project.slug, pageSlug, host)
}
