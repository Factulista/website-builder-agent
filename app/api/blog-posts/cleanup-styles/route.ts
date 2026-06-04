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

// Semantic attributes that are safe to keep
const KEEP_ATTRS = new Set(['class','href','src','alt','id','target','rel','colspan','rowspan','width','height','scope','type','name','value','placeholder','loading','decoding'])

/**
 * Strip all non-semantic attributes from a tag's attribute string.
 * Keeps only whitelisted attrs. Removes style, data-*, and any CSS fragment
 * that leaked out of a broken style attribute (e.g. <h1 space="" grotesk",="">).
 */
function cleanTagAttrs(attrs: string): string {
  const kept: string[] = []
  // Match standard attr="value" pairs
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(attrs)) !== null) {
    const name = m[1].toLowerCase()
    if (KEEP_ATTRS.has(name)) {
      const val = m[2] ?? m[3] ?? m[4] ?? ''
      kept.push(val ? `${name}="${val}"` : name)
    }
  }
  return kept.join(' ')
}

/**
 * Aggressively clean typography inline styles from blog post HTML.
 * Handles both clean style="" attrs and the severely broken case where
 * CSS values escaped the style attribute and became fake HTML attributes.
 */
function cleanInlineStyles(html: string): string {
  let r = html

  // 1. Fix &quot; / &#34; inside style attributes → real quotes
  r = r.replace(/style="([^"]*)"/g, (_, v) =>
    `style="${v.replace(/&quot;/g, '"').replace(/&#34;/g, '"')}"`)

  // 2. Unwrap <font> tags (obsolete HTML4)
  r = r.replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1')

  // 3. Strip ALL non-semantic attributes from every opening tag.
  //    This handles both style="" and broken CSS-fragment attributes like
  //    <h1 space="" grotesk",="" ui-sans-serif,="">.
  //    Only whitelisted semantic attrs (class, href, src, alt, id…) survive.
  r = r.replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\s*\/?)>/g, (_, tag, attrs, selfClose) => {
    const cleaned = cleanTagAttrs(attrs)
    return cleaned ? `<${tag} ${cleaned}${selfClose}>` : `<${tag}${selfClose}>`
  })

  // 4. Unwrap <span> with no attributes → keep text only (repeat for nesting)
  for (let i = 0; i < 3; i++) {
    r = r.replace(/<span>([\s\S]*?)<\/span>/g, '$1')
  }

  // 5. Remove data-astro-* and other framework artifacts that sneak in
  r = r.replace(/\s+data-[a-z][a-z0-9-]*(?:="[^"]*")?/g, '')

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
