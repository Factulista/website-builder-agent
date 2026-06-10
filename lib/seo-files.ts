type Page = { slug: string; name: string; inMenu?: boolean; robots?: { noindex?: boolean; nofollow?: boolean } }
type BlogPostRef = { slug: string; published_at: string | null }

export function generateSitemap(
  pages: Page[],
  baseUrl: string,
  projectSlug?: string,
  blogPosts: BlogPostRef[] = []
): string {
  // Exclude pages that are explicitly hidden (inMenu=false or null) or noindex=true
  const isVisible = (p: Page) => p.inMenu !== false && p.inMenu !== null && !p.robots?.noindex
  const visiblePages = pages.filter(isVisible)

  const pageUrls = visiblePages.map(page => {
    const isHome = page.slug === 'home'
    const loc = isHome ? `${baseUrl}/` : `${baseUrl}/${page.slug}`
    const priority = isHome ? '1.0' : '0.8'
    return `  <url>
    <loc>${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`
  })

  // Blog listing page
  const hasBlogPosts = blogPosts.length > 0
  const blogListUrl = hasBlogPosts ? `  <url>
    <loc>${baseUrl}/blog</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>` : ''

  const postUrls = blogPosts.map(post => {
    const lastmod = post.published_at ? `\n    <lastmod>${post.published_at.slice(0, 10)}</lastmod>` : ''
    return `  <url>
    <loc>${baseUrl}/blog/${post.slug}</loc>${lastmod}
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`
  })

  const allUrls = [...pageUrls, ...(hasBlogPosts ? [blogListUrl] : []), ...postUrls]

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.join('\n')}
</urlset>`
}

export function generateRobots(baseUrl: string, pages: Page[] = []): string {
  // Disallow draft/hidden pages (inMenu=false or null) and noindex pages
  const hiddenPages = pages.filter(p => p.inMenu === false || p.inMenu === null || p.robots?.noindex)
  const disallowLines = hiddenPages
    .map(p => `Disallow: /${p.slug === 'home' ? '' : p.slug}`)
    .join('\n')

  return `User-agent: *
Allow: /

# App routes — not public content
Disallow: /api/
Disallow: /back-office/
Disallow: /projects/
Disallow: /login
Disallow: /register
${disallowLines ? `\n# Draft / hidden pages\n${disallowLines}\n` : ''}
Sitemap: ${baseUrl}/sitemap.xml`
}
