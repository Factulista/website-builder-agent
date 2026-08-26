import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
import { compileSeo } from '../../../../lib/seo-compiler'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// One-off diagnostic: reproduces exactly what handlePublish() checks client-side
// (SEO compiler gate + custom domain requirement) so we can tell why a publish
// click silently did nothing, without needing browser access.
export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = getSupabase()
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, slug, custom_domain, custom_domain_status, site_config')
    .eq('id', projectId)
    .single()
  if (error || !project) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const config = (project.site_config ?? {}) as { pages?: Array<{ slug: string; name: string; html: string; robots?: { noindex?: boolean } }> }
  const pages = config.pages ?? []

  const isRootDomainProject = !!process.env.ROOT_DOMAIN_PROJECT && project.slug === process.env.ROOT_DOMAIN_PROJECT
  const domainGateBlocked = !isRootDomainProject && (!project.custom_domain || project.custom_domain_status !== 'verified')

  const report = compileSeo(pages, {})

  return NextResponse.json({
    slug: project.slug,
    rootDomainProjectEnv: process.env.ROOT_DOMAIN_PROJECT ?? null,
    isRootDomainProject,
    custom_domain: project.custom_domain,
    custom_domain_status: project.custom_domain_status,
    domainGateBlocked,
    pagesCount: pages.length,
    blockingIssues: report.blockingIssues,
    warningsCount: report.warnings.length,
    score: report.score,
  })
}
