/**
 * GET /api/internal/list-media?projectId=xxx&limit=20
 * Lists the most recently uploaded files in the project's storage folder, so we can
 * find images uploaded to the media library that aren't yet placed in a page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '20')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  // Find the owner to build the storage path: project-assets/{userId}/{projectId}/
  const { data: project } = await supabase.from('projects').select('user_id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const folder = `${project.user_id}/${projectId}`
  const { data: files, error } = await supabase.storage
    .from('project-assets')
    .list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/project-assets/${folder}/`
  const recent = (files ?? [])
    .filter(f => f.name && !f.name.startsWith('.'))
    .slice(0, limit)
    .map(f => ({
      name: f.name,
      created_at: f.created_at,
      url: base + f.name,
      sizeKB: f.metadata?.size ? Math.round((f.metadata.size as number) / 1024) : null,
    }))

  return NextResponse.json({ folder, count: recent.length, files: recent })
}
