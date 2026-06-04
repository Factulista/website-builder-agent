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
 * Aggressively clean typography inline styles from blog post HTML.
 * The Design System handles all typography globally — inline styles are redundant.
 */
function cleanInlineStyles(html: string): string {
  let r = html

  // 1. Fix &quot; / &#34; inside style attributes → real quotes
  r = r.replace(/style="([^"]*)"/g, (_, v) =>
    `style="${v.replace(/&quot;/g, '"').replace(/&#34;/g, '"')}"`)

  // 2. Unwrap <font> tags entirely (old HTML4 tag, never appropriate in blog content)
  r = r.replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1')

  // 3. Remove all inline typography props from style attributes
  //    (font-family, font-size, font-weight, color, line-height, letter-spacing)
  //    These are all owned by the Design System.
  const TYPO_PROPS = /(?:font-family|font-size|font-weight|line-height|letter-spacing)\s*:\s*[^;]+;?\s*/gi
  r = r.replace(/style="([^"]*)"/g, (_, v) => {
    let cleaned = v.replace(TYPO_PROPS, '').trim().replace(/;+$/, '').trim()
    // Also strip standalone color if it's a plain text color that DS owns
    cleaned = cleaned.replace(/\bcolor\s*:\s*#(?:1a1a1a|374151|000000|000)\s*;?\s*/gi, '').trim()
    return cleaned ? `style="${cleaned}"` : ''
  })

  // 4. Remove stray font-family text artifacts that leaked out of broken style attributes
  //    e.g.  <span Space Grotesk"; font-size:1rem;">  or  <h3><span "Space Grotesk";">
  r = r.replace(/<(span|h[1-6]|p|div|li)([^>]*?)\s+"?(?:Space Grotesk|Inter|Lato|Roboto|Open Sans|Montserrat)"?\s*;[^>]*>/gi,
    (_, tag, rest) => `<${tag}${rest.trim() ? ' ' + rest.trim() : ''}>`)

  // 5. Unwrap <span> with no remaining attributes → keep text only
  //    Loop twice to handle nested empty spans
  for (let i = 0; i < 3; i++) {
    r = r.replace(/<span>([\s\S]*?)<\/span>/g, '$1')
  }

  // 6. Clean up double spaces in tag attributes left by removals
  r = r.replace(/<(span|div|h[1-6]|p|li)\s{2,}/g, '<$1 ')

  return r
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
