import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateSitemap, generateRobots } from '../../../lib/seo-files'

export const runtime = 'nodejs'

function getProjectPublicBaseUrl(projectSlug: string, customDomain?: string | null): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
  const rootProject = process.env.ROOT_DOMAIN_PROJECT ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
  if (customDomain) return `https://${customDomain}`
  if (rootProject && projectSlug === rootProject) return `https://www.${rootDomain}`
  return `https://myweb.${rootDomain}/${projectSlug}`
}

// Handles myweb.factulista.com/{slug}/sitemap.xml and /robots.txt (staging)
// Also handles www.factulista.com/sitemap.xml and /robots.txt (root project via middleware rewrite)
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  const file = req.nextUrl.searchParams.get('file')
  // Optional host override: when the real request came from www.factulista.com, the middleware
  // passes ?host=www.factulista.com so we can build the correct canonical base URL.
  const hostOverride = req.nextUrl.searchParams.get('host')

  if (!slug || (file !== 'sitemap.xml' && file !== 'robots.txt')) {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: project } = await supabase
    .from('projects')
    .select('id, site_config, custom_domain')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single()

  if (!project) return new Response('Not found', { status: 404 })

  const siteConfig = (project.site_config ?? {}) as Record<string, unknown>
  const pages = (siteConfig.pages as { slug: string; name: string }[]) ?? []

  // If the middleware passed a host override (e.g. www.factulista.com), use that directly;
  // otherwise derive the correct URL from domain config and env vars.
  const baseUrl = hostOverride
    ? `https://${hostOverride}`
    : getProjectPublicBaseUrl(slug, project.custom_domain as string | null)

  if (file === 'sitemap.xml') {
    // Fetch published blog posts to include in sitemap
    const { data: blogPosts } = await supabase
      .from('blog_posts')
      .select('slug, published_at')
      .eq('project_id', project.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
    const xml = generateSitemap(pages, baseUrl, slug, blogPosts ?? [])
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  const robots = generateRobots(baseUrl, pages)
  return new Response(robots, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
