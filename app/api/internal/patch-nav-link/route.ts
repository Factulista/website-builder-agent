import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const { token, projectSlug } = await req.json()
  if (token !== 'factulista-patch-2025') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabase()
  const { data: projects } = await supabase
    .from('projects').select('id, name, slug, site_config')
    .or(`slug.eq.${projectSlug},name.ilike.%${projectSlug}%`).limit(5)

  if (!projects?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const results = []
  for (const project of projects) {
    const config = project.site_config as Record<string, unknown>
    const pages = (config?.pages as Array<{ slug: string; html: string }>) ?? []

    // Find a nav link that looks like a reference nav item (Funcionalidades/Precios)
    // so we can copy its classes/style
    const home = pages.find(p => p.slug === 'home')
    if (!home) { results.push({ name: project.name, slug: (project as any).slug, status: 'no home page' }); continue }

    // Extract a reference nav link to see its exact HTML pattern
    const refMatch = home.html.match(/<a[^>]+href[^>]*>[^<]*(?:Funcionalidades|Precios)[^<]*<\/a>/i)
    const loginMatch = home.html.match(/<a[^>]+href[^>]*>[^<]*Iniciar\s+ses[ií]n[^<]*<\/a>/i)

    if (!loginMatch) { results.push({ name: project.name, slug: (project as any).slug, status: 'login link not found', ref: refMatch?.[0]?.slice(0,150) }); continue }

    // Get the class/style from the reference nav link
    const refTag = refMatch?.[0] ?? ''
    const refClassMatch = refTag.match(/class="([^"]*)"/)
    const refStyleMatch = refTag.match(/style="([^"]*)"/)
    const refClass = refClassMatch?.[1] ?? ''
    const refStyle = refStyleMatch?.[1] ?? ''

    // Build replacement login link preserving its href but using ref styling
    const loginHref = loginMatch[0].match(/href="([^"]*)"/)?.[1] ?? '#'
    const loginText = loginMatch[0].replace(/<[^>]+>/g, '').trim()

    let newTag = `<a href="${loginHref}"`
    if (refClass) newTag += ` class="${refClass}"`
    if (refStyle) newTag += ` style="${refStyle}"`
    newTag += `>${loginText}</a>`

    const newHtml = home.html.replace(loginMatch[0], newTag)
    const changed = newHtml !== home.html

    if (changed) {
      const updatedPages = pages.map(p => p.slug === 'home' ? { ...p, html: newHtml } : p)
      await supabase.from('projects').update({
        site_config: { ...config, pages: updatedPages },
        updated_at: new Date().toISOString(),
      }).eq('id', project.id)
    }

    results.push({
      name: project.name, slug: (project as any).slug,
      status: changed ? 'updated' : 'no_change',
      loginFound: loginMatch[0].slice(0, 120),
      refFound: refTag.slice(0, 120),
      newTag,
    })
  }

  return NextResponse.json({ results })
}
