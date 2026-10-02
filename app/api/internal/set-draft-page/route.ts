/**
 * POST /api/internal/set-draft-page  Body: { projectId, slug, html, name? }
 * Replaces the html (and optionally the name) of ONE existing draft page — e.g. to
 * write a generated draft. Never touches published pages or other drafts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { updatePages } from '../../../../lib/pages-store'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const body = await req.json().catch(() => null)
  const { projectId, slug, html, name } = (body ?? {}) as { projectId?: string; slug?: string; html?: string; name?: string }
  if (!projectId || !slug || typeof html !== 'string' || html.length < 100) {
    return NextResponse.json({ error: 'projectId, slug and html required' }, { status: 400 })
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  let found = false
  await updatePages<{ slug: string; html?: string; name?: string }>(sb, projectId, 'draft', pages => {
    if (!pages.some(p => p.slug === slug)) return pages
    found = true
    return pages.map(p => (p.slug === slug ? { ...p, html, ...(name ? { name } : {}) } : p))
  })
  if (!found) return NextResponse.json({ error: `draft page "${slug}" not found` }, { status: 404 })
  return NextResponse.json({ message: `Draft "${slug}" updated (${html.length} chars)` })
}
