type Page = { slug: string; name: string; html?: string; inMenu?: boolean; robots?: { noindex?: boolean; nofollow?: boolean }; og_title?: string }
type BlogPostRef = { slug: string; title?: string; published_at: string | null; seo_description?: string }

function extractMetaDescription(html: string): string | undefined {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,})/i)
    ?? html.match(/<meta[^>]+content=["']([^"']{10,})["'][^>]+name=["']description["']/i)
  return m?.[1]?.trim() || undefined
}

function extractH1(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return m?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined
}

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

/**
 * Generate /llms.txt — a content-driven markdown summary for AI assistants.
 * Schema: https://llmstxt.org (inspired by framer.com/llms.txt)
 * Dynamically generated from live page HTML + blog posts on every request.
 *
 * Content-driven, NOT keyword-driven:
 * - Extracts descriptions from meta tags, H1, H2 from page HTML
 * - Shows all visible pages with their descriptions
 * - Shows blog posts with their descriptions
 * - NO artificial keyword lists — only what's on the pages
 */
export function generateLlmsTxt(
  pages: Page[],
  baseUrl: string,
  siteName: string,
  siteDescription?: string,
  blogPosts: BlogPostRef[] = [],
  _seoKeywords: string[] = [] // Unused — content comes from pages only
): string {
  const isVisible = (p: Page) => p.inMenu !== false && p.inMenu !== null && !p.robots?.noindex
  const visiblePages = pages.filter(isVisible)

  // Extract metadata + content from page HTML
  const richPages = visiblePages.map(p => {
    const html = p.html ?? ''
    const description = extractMetaDescription(html)
    const h1 = extractH1(html)
    return { ...p, description, h1 }
  })

  // Home page extracts as intro + features
  const home = richPages.find(p => p.slug === 'home')
  const otherPages = richPages.filter(p => p.slug !== 'home')

  // Extract key features from home H2s
  let featuresBlock = ''
  if (home?.html) {
    const h2matches = [...(home.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi))]
    const h2s = h2matches
      .map(m => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 3 && t.length < 120)
      .slice(0, 10)
    if (h2s.length > 0) {
      featuresBlock = `\nKey features:\n${h2s.map(h => `- ${h}`).join('\n')}\n`
    }
  }

  // All pages with descriptions
  const pageLines = richPages.map(p => {
    const url = p.slug === 'home' ? `${baseUrl}/` : `${baseUrl}/${p.slug}`
    const label = p.og_title || p.h1 || p.name
    const desc = p.description ? `: ${p.description.slice(0, 160)}` : ''
    return `- [${label}](${url})${desc}`
  }).join('\n')

  // Blog posts with descriptions
  const blogLines = blogPosts.length > 0
    ? blogPosts.slice(0, 25).map(post => {
        const url = `${baseUrl}/blog/${post.slug}`
        const title = post.title || post.slug
        const desc = post.seo_description ? `: ${post.seo_description.slice(0, 160)}` : ''
        return `- [${title}](${url})${desc}`
      }).join('\n')
    : ''

  const descBlock = siteDescription ? `\n> ${siteDescription}` : ''

  return `# ${siteName}
${descBlock}${featuresBlock}
## Pages

${pageLines}
${blogPosts.length > 0 ? `\n## Blog\n\n${blogLines}` : ''}

## Resources

- [Sitemap](${baseUrl}/sitemap.xml): Full page list
- [Robots.txt](${baseUrl}/robots.txt): Crawler directives
- Updated: ${new Date().toISOString().slice(0, 10)}
`
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
