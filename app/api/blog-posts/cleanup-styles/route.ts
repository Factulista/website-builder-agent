import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const { data: { user } } = await getSupabase().auth.getUser(auth.slice(7))
  return user
}

/**
 * Remove redundant inline typography styles from blog post HTML.
 * These were injected by the AI before the Design System was in place.
 *
 * Rules:
 * 1. Remove font-family declarations from all style attributes
 * 2. Remove font-size declarations that duplicate what the DS sets (h1/h2/h3/p/li)
 * 3. If a style attribute becomes empty → remove it entirely
 * 4. If a <span> has no remaining attributes → unwrap it (keep text content)
 * 5. Fix &quot; inside style attributes → real quotes
 */
function cleanInlineStyles(html: string): string {
  // Fix HTML-encoded quotes in style attributes first
  let result = html.replace(/style="([^"]*)"/g, (_, styleVal) => {
    const fixed = styleVal.replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    return `style="${fixed}"`
  })

  // Remove specific typography props from style attributes
  // These are now handled by the Design System globally
  const REMOVABLE_PROPS = [
    /font-family\s*:\s*[^;]+;?\s*/gi,
    // Only remove font-size from inline <span> (not block elements — those are structural)
  ]

  result = result.replace(/style="([^"]*)"/g, (match, styleVal) => {
    let cleaned = styleVal
    for (const re of REMOVABLE_PROPS) {
      cleaned = cleaned.replace(re, '')
    }
    cleaned = cleaned.trim().replace(/;+$/, '').trim()
    if (!cleaned) return '' // remove empty style=""
    return `style="${cleaned}"`
  })

  // Unwrap <span> tags that have no attributes left
  // e.g. <span>text</span> → text
  // Be careful: only unwrap spans with NO attributes at all
  result = result.replace(/<span>([\s\S]*?)<\/span>/g, '$1')

  // Clean up extra whitespace from removed attributes (e.g. <span  class=...)
  result = result.replace(/<span\s{2,}/g, '<span ')

  return result
}

export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const { projectId } = await req.json()
  if (!projectId) return NextResponse.json({ error: 'projectId richiesto' }, { status: 400 })

  const supabase = getSupabase()

  // Verify user owns this project
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .single()

  if (!project || project.user_id !== user.id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Fetch all posts with content_html
  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, title, content_html')
    .eq('project_id', projectId)
    .not('content_html', 'is', null)

  if (!posts || posts.length === 0) {
    return NextResponse.json({ updated: 0, message: 'Nessun articolo trovato' })
  }

  let updated = 0
  const results: { id: string; title: string; changed: boolean }[] = []

  for (const post of posts) {
    const original = post.content_html ?? ''
    const cleaned = cleanInlineStyles(original)

    if (cleaned !== original) {
      await supabase
        .from('blog_posts')
        .update({ content_html: cleaned, updated_at: new Date().toISOString() })
        .eq('id', post.id)
      updated++
      results.push({ id: post.id, title: post.title, changed: true })
    } else {
      results.push({ id: post.id, title: post.title, changed: false })
    }
  }

  return NextResponse.json({
    updated,
    total: posts.length,
    results,
  })
}
