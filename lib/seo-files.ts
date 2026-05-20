type Page = { slug: string; name: string }
type BlogPostRef = { slug: string; published_at: string | null }

export function generateSitemap(
  pages: Page[],
  baseUrl: string,
  projectSlug?: string,
  blogPosts: BlogPostRef[] = []
): string {
  const pageUrls = pages.map(page => {
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

export function generateRobots(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml`
}
