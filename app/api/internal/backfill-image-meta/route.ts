/**
 * POST /api/internal/backfill-image-meta
 * Retroactively applies image metadata (alt, title) to all pages and blog posts
 * for a given project. Matches img[src] against site_config.media keys.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type MediaMeta = { alt?: string; title?: string; caption?: string; description?: string }

/** Apply metadata to all <img> tags in an HTML string whose src matches known media */
function applyMetaToHtml(html: string, mediaByUrl: Map<string, MediaMeta>): { html: string; changed: boolean } {
  let changed = false
  const result = html.replace(/<img([^>]*)>/gi, (tag, attrs) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/)
    if (!srcMatch) return tag
    const src = srcMatch[1]

    // Find matching meta — try exact URL, or by Supabase path suffix
    let meta: MediaMeta | undefined
    for (const [key, val] of mediaByUrl) {
      if (src === key || src.endsWith(key) || key.endsWith(src.split('/').pop()!)) {
        meta = val
        break
      }
    }
    if (!meta) return tag

    let newAttrs = attrs

    // Update or add alt
    if (meta.alt) {
      if (/\balt=["'][^"']*["']/.test(newAttrs)) {
        const current = newAttrs.match(/\balt=["']([^"']*)["']/)?.[1] ?? ''
        if (current !== meta.alt) {
          newAttrs = newAttrs.replace(/\balt=["'][^"']*["']/, `alt="${meta.alt.replace(/"/g, '&quot;')}"`)
          changed = true
        }
      } else {
        newAttrs += ` alt="${meta.alt.replace(/"/g, '&quot;')}"`
        changed = true
      }
    }

    // Update or add title
    if (meta.title) {
      if (/\btitle=["'][^"']*["']/.test(newAttrs)) {
        const current = newAttrs.match(/\btitle=["']([^"']*)["']/)?.[1] ?? ''
        if (current !== meta.title) {
          newAttrs = newAttrs.replace(/\btitle=["'][^"']*["']/, `title="${meta.title.replace(/"/g, '&quot;')}"`)
          changed = true
        }
      } else {
        newAttrs += ` title="${meta.title.replace(/"/g, '&quot;')}"`
        changed = true
      }
    }

    if (newAttrs === attrs) return tag
    return `<img${newAttrs}>`
  })

  return { html: result, changed }
}

export async function POST(req: NextRequest) {
  const { token, projectSlug, dryRun = false } = await req.json()
  if (token !== 'factulista-patch-2025') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabase()

  // Find project
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug, site_config')
    .or(`slug.eq.${projectSlug},name.ilike.%${projectSlug}%`)
    .limit(5)

  if (!projects?.length) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const results = []

  for (const project of projects) {
    const config = project.site_config as Record<string, unknown>
    const media = (config?.media ?? {}) as Record<string, MediaMeta>
    const pages = (config?.pages ?? []) as Array<{ slug: string; name: string; html: string }>

    if (!Object.keys(media).length) {
      results.push({ slug: project.slug, status: 'no media metadata found' })
      continue
    }

    // Build a map from public URL to metadata
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const mediaByUrl = new Map<string, MediaMeta>()
    for (const [path, meta] of Object.entries(media)) {
      // path is like "user-id/project-id/filename.png"
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/project-assets/${path}`
      mediaByUrl.set(publicUrl, meta)
      // also index by filename for fuzzy matching
      mediaByUrl.set(path.split('/').pop()!, meta)
    }

    // --- Fix pages ---
    let pagesChanged = 0
    const updatedPages = pages.map(p => {
      const { html, changed } = applyMetaToHtml(p.html, mediaByUrl)
      if (changed) pagesChanged++
      return { ...p, html }
    })

    // --- Fix blog posts ---
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('id, slug, content_html')
      .eq('project_id', project.id)

    let postsChanged = 0
    const updatedPosts: Array<{ id: string; content_html: string }> = []
    for (const post of posts ?? []) {
      const { html, changed } = applyMetaToHtml(post.content_html ?? '', mediaByUrl)
      if (changed) {
        postsChanged++
        updatedPosts.push({ id: post.id, content_html: html })
      }
    }

    if (!dryRun) {
      // Save pages
      if (pagesChanged > 0) {
        await supabase.from('projects').update({
          site_config: { ...config, pages: updatedPages },
          updated_at: new Date().toISOString(),
        }).eq('id', project.id)
      }
      // Save blog posts
      for (const p of updatedPosts) {
        await supabase.from('blog_posts').update({
          content_html: p.content_html,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id)
      }
    }

    results.push({
      name: project.name,
      slug: project.slug,
      mediaEntries: Object.keys(media).length,
      pagesScanned: pages.length,
      pagesChanged,
      blogPostsScanned: posts?.length ?? 0,
      blogPostsChanged: postsChanged,
      dryRun,
    })
  }

  return NextResponse.json({ results })
}
