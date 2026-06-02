import { NextRequest, NextResponse } from 'next/server'
import { requireUserAndProject, getServiceSupabase, jsonError, ApiError } from '../../../lib/api-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

interface SitePage {
  slug: string
  name: string
  html?: string
}

interface BrokenLink {
  url: string
  status: number | string
}

interface PageResult {
  pageSlug: string
  pageName: string
  brokenLinks: BrokenLink[]
}

function getProjectPublicBaseUrl(projectSlug: string, customDomain?: string | null): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
  const rootProject = process.env.ROOT_DOMAIN_PROJECT ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
  if (customDomain) return `https://${customDomain}`
  if (rootProject && projectSlug === rootProject) return `https://www.${rootDomain}`
  return `https://myweb.${rootDomain}/${projectSlug}`
}

function extractHrefs(html: string): string[] {
  const hrefs: string[] = []
  const re = /href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    hrefs.push(m[1])
  }
  return hrefs
}

function shouldSkipUrl(url: string): boolean {
  if (url.startsWith('mailto:')) return true
  if (url.startsWith('tel:')) return true
  if (url.startsWith('javascript:')) return true
  if (url.startsWith('#')) return true
  if (/localhost(:\d+)?/.test(url)) return true
  // Skip Supabase storage URLs — they are always valid CDN assets
  if (url.includes('supabase.co/storage')) return true
  if (url.includes('supabase.in/storage')) return true
  return false
}

async function checkUrl(url: string): Promise<{ url: string; status: number | string }> {
  // First try HEAD
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Factulista-LinkChecker/1.0' },
    })
    if (resp.status < 400) return { url, status: resp.status }
    // Some servers respond to HEAD with 405 — retry with GET
    if (resp.status === 405) {
      const resp2 = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Factulista-LinkChecker/1.0' },
      })
      return { url, status: resp2.status }
    }
    return { url, status: resp.status }
  } catch {
    // Network error or timeout — retry with GET once
    try {
      const resp2 = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Factulista-LinkChecker/1.0' },
      })
      return { url, status: resp2.status }
    } catch {
      return { url, status: 'Timeout' }
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') ?? ''
    const { project } = await requireUserAndProject(req, projectId)

    // Fetch custom_domain and custom_domain_status (not included in requireUserAndProject's select)
    const supabase = getServiceSupabase()
    const { data: projectExtra } = await supabase
      .from('projects')
      .select('custom_domain, custom_domain_status')
      .eq('id', projectId)
      .single()

    const customDomain =
      projectExtra?.custom_domain_status === 'verified'
        ? (projectExtra.custom_domain as string | null)
        : null

    const siteConfig = (project.site_config ?? {}) as { pages?: SitePage[] }
    const pages: SitePage[] = siteConfig.pages ?? []

    const baseUrl = getProjectPublicBaseUrl(project.slug, customDomain)

    // Collect all hrefs per page
    const pageHrefs = new Map<string, Set<string>>() // pageSlug → hrefs

    for (const page of pages) {
      const html = page.html ?? ''
      const hrefs = extractHrefs(html)
      const pageBase = `${baseUrl}/${page.slug === 'index' ? '' : page.slug}`

      const resolved = new Set<string>()
      for (const href of hrefs) {
        if (shouldSkipUrl(href)) continue
        try {
          let fullUrl: string
          if (href.startsWith('http://') || href.startsWith('https://')) {
            fullUrl = href
          } else if (href.startsWith('//')) {
            fullUrl = `https:${href}`
          } else {
            // Resolve relative URL against the page base
            fullUrl = new URL(href, pageBase).toString()
          }
          resolved.add(fullUrl)
        } catch {
          // Invalid URL — skip
        }
      }
      if (resolved.size > 0) {
        pageHrefs.set(page.slug, resolved)
      }
    }

    // Deduplicate across all pages
    const allUrls = new Set<string>()
    for (const hrefs of pageHrefs.values()) {
      for (const url of hrefs) allUrls.add(url)
    }

    const urlList = Array.from(allUrls)
    const totalChecked = urlList.length

    // Check all URLs (up to 60 concurrently in batches of 10 to avoid rate limits)
    const urlStatuses = new Map<string, number | string>()
    const BATCH_SIZE = 10
    for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
      const batch = urlList.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(batch.map(checkUrl))
      for (const r of results) {
        urlStatuses.set(r.url, r.status)
      }
    }

    // Group broken links by page
    const results: PageResult[] = []
    for (const page of pages) {
      const hrefs = pageHrefs.get(page.slug)
      if (!hrefs) continue
      const brokenLinks: BrokenLink[] = []
      for (const url of hrefs) {
        const status = urlStatuses.get(url)
        if (status === undefined) continue
        const isBroken =
          status === 'Timeout' ||
          (typeof status === 'number' && status >= 400)
        if (isBroken) {
          brokenLinks.push({ url, status })
        }
      }
      if (brokenLinks.length > 0) {
        results.push({ pageSlug: page.slug, pageName: page.name, brokenLinks })
      }
    }

    const totalBroken = results.reduce((s, r) => s + r.brokenLinks.length, 0)

    return NextResponse.json({ results, totalChecked, totalBroken })
  } catch (err) {
    return jsonError(err)
  }
}
