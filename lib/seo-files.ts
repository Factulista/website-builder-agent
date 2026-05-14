type Page = { slug: string; name: string }

export function generateSitemap(
  pages: Page[],
  baseUrl: string,
  projectSlug?: string
): string {
  const urls = pages.map(page => {
    // For staging (myweb.factulista.com/{projectSlug}/...), home maps to base, others to /{pageSlug}
    // For custom domains, home maps to /, others to /{pageSlug}
    const isHome = page.slug === 'home'
    const loc = isHome ? `${baseUrl}/` : `${baseUrl}/${page.slug}`
    const priority = isHome ? '1.0' : '0.8'
    return `  <url>
    <loc>${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`
}

export function generateRobots(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml`
}
