/**
 * POST /api/internal/set-mega-pages
 * Assigns megaMenu, megaMenuIcon, megaMenuLabel fields to pages (both draft + published) in bulk.
 * Body: { projectId, assignments: [{ slug, megaMenu, megaMenuIcon?, megaMenuLabel? }] }
 * Pass megaMenu: "" to remove a page from all mega menus.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readAllPages, writePages } from '../../../../lib/pages-store'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { withSnapshotRegen } from '../../../../lib/published-snapshots'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function handlePOST(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId as string | undefined
  const assignments = (body?.assignments as Array<{ slug: string; megaMenu: string; megaMenuIcon?: string; megaMenuLabel?: string }>) ?? []
  if (!projectId || !assignments.length) {
    return NextResponse.json({ error: 'projectId and assignments required' }, { status: 400 })
  }
  const supabase = getSupabase()
  let all: Awaited<ReturnType<typeof readAllPages>>
  try { all = await readAllPages(supabase, projectId) } catch { return NextResponse.json({ error: 'project not found' }, { status: 404 }) }
  const assignMap = new Map(assignments.map(a => [a.slug, a]))

  const applyToList = (list: Array<Record<string, unknown>>) =>
    list.map(p => {
      const slug = p.slug as string
      if (!assignMap.has(slug)) return p
      const a = assignMap.get(slug)!
      const updated = { ...p }
      if (a.megaMenu) {
        updated.megaMenu = a.megaMenu
      } else {
        delete updated.megaMenu
      }
      if (a.megaMenuIcon) {
        updated.megaMenuIcon = a.megaMenuIcon
      }
      if (a.megaMenuLabel) {
        updated.megaMenuLabel = a.megaMenuLabel
      }
      return updated
    })

  const pages = applyToList(all.draft as Array<Record<string, unknown>>) as Array<Record<string, unknown> & { slug: string }>
  const published = applyToList(all.published as Array<Record<string, unknown>>) as Array<Record<string, unknown> & { slug: string }>

  const applied = assignments.filter(a => [...pages, ...published].some(p => p.slug === a.slug)).map(a => a.slug)

  try {
    await writePages(supabase, projectId, 'draft', pages)
    await writePages(supabase, projectId, 'published', published)
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  return NextResponse.json({ message: 'mega menu assignments updated', applied })
}

// Re-render the project's published snapshots after a successful change.
export const POST = withSnapshotRegen(handlePOST)
