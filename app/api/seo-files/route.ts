import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateSitemap, generateRobots } from '../../../lib/seo-files'

export const runtime = 'nodejs'

// Handles myweb.factulista.com/{slug}/sitemap.xml and /robots.txt (staging)
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  const file = req.nextUrl.searchParams.get('file')

  if (!slug || (file !== 'sitemap.xml' && file !== 'robots.txt')) {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: project } = await supabase
    .from('projects')
    .select('site_config')
    .eq('slug', slug)
    .is('deleted_at', null)
    .single()

  if (!project) return new Response('Not found', { status: 404 })

  const siteConfig = (project.site_config ?? {}) as Record<string, unknown>
  const pages = (siteConfig.pages as { slug: string; name: string }[]) ?? []
  const baseUrl = `https://myweb.factulista.com/${slug}`

  if (file === 'sitemap.xml') {
    const xml = generateSitemap(pages, baseUrl, slug)
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    })
  }

  const robots = generateRobots(baseUrl)
  return new Response(robots, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
