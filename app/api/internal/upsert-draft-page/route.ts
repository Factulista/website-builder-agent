/**
 * POST /api/internal/upsert-draft-page
 * Body: { projectId, slug, html, name, fields?: { megaMenu?, megaMenuLabel?, megaMenuIcon?, menuLabel?, inMenu?, og_title? } }
 * Creates the DRAFT page if it doesn't exist (appended at the end), or replaces its html/name/fields.
 * Never touches published pages: the page goes live only when published from the builder.
 * Stale `blocks` are dropped so the builder re-splits the new html.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { updatePages } from '../../../../lib/pages-store'

export const runtime = 'nodejs'

const ALLOWED = ['megaMenu', 'megaMenuLabel', 'megaMenuIcon', 'menuLabel', 'inMenu', 'og_title'] as const

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const body = await req.json().catch(() => null)
  const { projectId, slug, html, name, fields } = (body ?? {}) as { projectId?: string; slug?: string; html?: string; name?: string; fields?: Record<string, unknown> }
  if (!projectId || !slug || !name || typeof html !== 'string' || html.length < 100) {
    return NextResponse.json({ error: 'projectId, slug, name and html required' }, { status: 400 })
  }
  const extra: Record<string, unknown> = {}
  for (const k of ALLOWED) if (fields && k in fields) extra[k] = fields[k]
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  let created = false
  await updatePages<{ slug: string; html?: string; name?: string; blocks?: unknown }>(sb, projectId, 'draft', pages => {
    if (pages.some(p => p.slug === slug)) {
      return pages.map(p => {
        if (p.slug !== slug) return p
        const { blocks: _drop, ...rest } = p
        return { ...rest, html, name, ...extra }
      })
    }
    created = true
    return [...pages, { slug, name, html, ...extra }]
  })
  return NextResponse.json({ message: `Draft "${slug}" ${created ? 'created' : 'updated'} (${html.length} chars)`, created })
}
