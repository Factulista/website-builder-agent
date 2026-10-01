/**
 * GET /api/internal/versions-stats?projectId=xxx   (read-only)
 * Version history of a project: each version's date/summary/page count, plus the
 * deduplicated html storage (page_html_blobs) — count and bytes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: versions, error } = await sb.from('project_versions')
    .select('id, summary, created_at, pages').eq('project_id', projectId).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: blobs } = await sb.from('page_html_blobs').select('hash, html').eq('project_id', projectId)
  const blobBytes = (blobs ?? []).reduce((n, b) => n + Buffer.byteLength(b.html as string), 0)
  return NextResponse.json({
    versions: (versions ?? []).map(v => {
      const pages = Array.isArray(v.pages) ? v.pages as Array<Record<string, unknown>> : null
      return {
        created_at: v.created_at,
        summary: v.summary,
        pages: pages?.length ?? 0,
        format: pages ? (pages.some(p => 'html_ref' in p) ? 'dedup' : 'legacy') : 'empty',
        metaBytes: JSON.stringify(v.pages ?? null).length,
        refs: req.nextUrl.searchParams.get('refs') === '1' && pages ? Object.fromEntries(pages.map(p => [String(p.slug), String(p.html_ref ?? '').slice(0, 16)])) : undefined,
      }
    }),
    blobs: { count: blobs?.length ?? 0, htmlBytes: blobBytes },
  })
}
