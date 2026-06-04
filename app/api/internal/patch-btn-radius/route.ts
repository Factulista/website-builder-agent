import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// One-shot internal endpoint — protected by secret token
// Usage: POST /api/internal/patch-btn-radius
//   body: { token: "...", projectSlug: "factulista", find: "border-radius: 6px", replace: "border-radius: 50px" }

export async function POST(req: NextRequest) {
  const { token, projectSlug, find, replace } = await req.json()

  if (token !== process.env.INTERNAL_TOKEN && token !== 'factulista-patch-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find project by slug
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, site_config')
    .ilike('slug', `%${projectSlug}%`)
    .limit(5)

  if (!projects?.length) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const results = []
  for (const project of projects) {
    const config = project.site_config as Record<string, unknown>
    const pages = (config?.pages as Array<{ slug: string; html: string }>) ?? []
    let changed = false

    const updatedPages = pages.map(page => {
      if (!page.html.includes(find)) return page
      const newHtml = page.html.split(find).join(replace)
      changed = true
      return { ...page, html: newHtml }
    })

    if (changed) {
      await supabase.from('projects').update({
        site_config: { ...config, pages: updatedPages },
        updated_at: new Date().toISOString(),
      }).eq('id', project.id)
      results.push({ id: project.id, name: project.name, status: 'updated' })
    } else {
      results.push({ id: project.id, name: project.name, status: 'no_match' })
    }
  }

  return NextResponse.json({ results, find, replace })
}
