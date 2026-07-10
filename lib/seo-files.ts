type Page = { slug: string; name: string; html?: string; inMenu?: boolean; robots?: { noindex?: boolean; nofollow?: boolean }; og_title?: string; megaMenu?: string }
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

function extractFirstParagraph(html: string): string | undefined {
  // Extract first <p> tag after H1
  const m = html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i)
    ?? html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) // Fallback: any first <p>
  const text = m?.[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return text && text.length > 50 ? text : undefined // Min 50 chars to be meaningful
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

// Legal/boilerplate pages carry no value for AI assistants — moved to the
// "Optional" section (llmstxt.org: URLs that can be skipped for short context).
const LEGAL_SLUG_RE = /(aviso-legal|politica|privacidad|cookies|condiciones|terminos|dpa|rgpd|legal|privacy|terms)/i

/**
 * Generate /llms.txt — a content-driven markdown summary for AI assistants.
 * Schema: https://llmstxt.org (inspired by framer.com/llms.txt)
 * Dynamically generated from live page HTML + blog posts on every request.
 *
 * Structure (facts first — LLM parsers weight the top of the file):
 * 1. Title + description + introduction (llmsIntroduction = the per-project
 *    hook for hard citable facts: pricing, compliance, company info)
 * 2. Pages (content pages with descriptions)
 * 3. Blog posts
 * 4. Key features (capped, de-noised — marketing headlines add little)
 * 5. Optional (legal pages) + Resources (incl. llms-full.txt)
 */
export function generateLlmsTxt(
  pages: Page[],
  baseUrl: string,
  siteName: string,
  siteDescription?: string,
  blogPosts: BlogPostRef[] = [],
  llmsIntroduction?: string
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

  const home = richPages.find(p => p.slug === 'home')

  // Use custom introduction if provided, otherwise extract from home
  let introBlock = ''
  if (llmsIntroduction) {
    introBlock = `\n${llmsIntroduction}\n`
  } else if (home?.html) {
    const firstParagraph = extractFirstParagraph(home.html)
    if (firstParagraph) {
      introBlock = `\n${firstParagraph}\n`
    }
  }

  // Extract key features from H2s (home + feature pages), FAQ/CTA stripped,
  // deduplicated and capped low: they are headlines, not facts.
  let featuresBlock = ''
  {
    const featurePages: Page[] = [
      ...(home ? [home] : []),
      ...pages.filter(p => p.megaMenu === 'funcionalidades' && p.slug !== 'home'),
    ]
    const seen = new Set<string>()
    const features: string[] = []
    for (const fp of featurePages) {
      const cleaned = (fp.html ?? '').replace(
        /<section[^>]*class="[^"]*(?:faq|cta-banner)[^"]*"[^>]*>[\s\S]*?<\/section>/gi,
        ''
      )
      for (const m of cleaned.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)) {
        const t = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        const key = t.toLowerCase()
        if (t.length > 3 && t.length < 140 && !seen.has(key)) {
          seen.add(key)
          features.push(t)
        }
      }
    }
    if (features.length > 0) {
      featuresBlock = `\n## Key features\n\n${features.slice(0, 12).map(h => `- ${h}`).join('\n')}\n`
    }
  }

  // Content pages vs legal boilerplate
  const contentPages = richPages.filter(p => !LEGAL_SLUG_RE.test(p.slug))
  const legalPages = richPages.filter(p => LEGAL_SLUG_RE.test(p.slug))

  const pageLine = (p: (typeof richPages)[number]) => {
    const url = p.slug === 'home' ? `${baseUrl}/` : `${baseUrl}/${p.slug}`
    // Prefer the H1 (what the page actually says) over og_title, which can be
    // stale or truncated; cap length so one long heading doesn't bloat the line.
    const label = (p.h1 || p.og_title || p.name).slice(0, 90)
    const desc = p.description ? `: ${p.description.slice(0, 160)}` : ''
    return `- [${label}](${url})${desc}`
  }
  const pageLines = contentPages.map(pageLine).join('\n')
  const legalLines = legalPages.map(pageLine).join('\n')

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
${descBlock}${introBlock}
## Pages

${pageLines}
${blogPosts.length > 0 ? `\n## Blog\n\n${blogLines}` : ''}${featuresBlock}
${legalPages.length > 0 ? `\n## Optional\n\n${legalLines}\n` : ''}
## Resources

- [Full content](${baseUrl}/llms-full.txt): Complete page text for AI assistants
- [Sitemap](${baseUrl}/sitemap.xml): Full page list
- [Robots.txt](${baseUrl}/robots.txt): Crawler directives
- Updated: ${new Date().toISOString().slice(0, 10)}
`
}

/** Strip HTML to readable plain text: drop scripts/styles/nav/footer, keep headings as markdown. */
function htmlToText(html: string, maxChars = 4000): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${t}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${t}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${t}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t}\n`)
    .replace(/<\/(p|div|section|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  // Decode the handful of entities that matter for readability
  s = s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // Collapse whitespace but keep line structure
  s = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n')
  return s.length > maxChars ? s.slice(0, maxChars) + '…' : s
}

/**
 * Generate /llms-full.txt — extended version with the full text content of
 * every visible page (llmstxt.org convention). Blog posts included with their
 * full text when available, else description + link.
 */
export function generateLlmsFullTxt(
  pages: Page[],
  baseUrl: string,
  siteName: string,
  siteDescription?: string,
  blogPosts: Array<BlogPostRef & { content_html?: string | null }> = [],
  llmsIntroduction?: string
): string {
  const isVisible = (p: Page) => p.inMenu !== false && p.inMenu !== null && !p.robots?.noindex
  const visiblePages = pages.filter(isVisible).filter(p => !LEGAL_SLUG_RE.test(p.slug))

  const intro = llmsIntroduction ? `\n${llmsIntroduction}\n` : (siteDescription ? `\n> ${siteDescription}\n` : '')

  const pageSections = visiblePages.map(p => {
    const url = p.slug === 'home' ? `${baseUrl}/` : `${baseUrl}/${p.slug}`
    const title = extractH1(p.html ?? '') || p.name
    return `---\n\n# ${title}\nURL: ${url}\n\n${htmlToText(p.html ?? '')}`
  }).join('\n\n')

  const blogSections = blogPosts.slice(0, 30).map(post => {
    const url = `${baseUrl}/blog/${post.slug}`
    const body = post.content_html
      ? htmlToText(post.content_html, 6000)
      : (post.seo_description ?? '')
    return `---\n\n# ${post.title || post.slug}\nURL: ${url}\n\n${body}`
  }).join('\n\n')

  return `# ${siteName} — full content
${intro}
${pageSections}
${blogSections ? `\n${blogSections}\n` : ''}
---
Updated: ${new Date().toISOString().slice(0, 10)}
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
Content-Signal: ai-train=no, search=yes, ai-input=yes

# App routes — not public content
Disallow: /api/
Disallow: /back-office/
Disallow: /projects/
Disallow: /login
Disallow: /register
${disallowLines ? `\n# Draft / hidden pages\n${disallowLines}\n` : ''}
Sitemap: ${baseUrl}/sitemap.xml`
}
