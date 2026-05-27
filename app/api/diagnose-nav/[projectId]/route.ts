// Temporary diagnostic + repair endpoint for the navbar-items-missing bug.
// DELETE this file once the affected projects are repaired.
//
// GET  /api/diagnose-nav/<projectId>           → returns diagnosis JSON
// POST /api/diagnose-nav/<projectId>           → applies the fix (adds missing pages to nav)

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

type Page = { slug: string; name?: string; html: string; inMenu?: boolean; menuLabel?: string }

function parseNavItems(navHtml: string): { href: string; text: string }[] {
  const items: { href: string; text: string }[] = []
  // Match every <a ... href="..."...>text</a> inside the nav
  const re = /<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(navHtml)) !== null) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    items.push({ href, text })
  }
  return items
}

function matchesSlug(href: string, slug: string): boolean {
  if (slug === 'home') {
    return href === './' || href === '/' || href === '' || href === './index.html' || href === '/index.html'
  }
  const variants = [`./${slug}`, `/${slug}`, slug, `./${slug}.html`, `/${slug}.html`, `./${slug}/`, `/${slug}/`]
  if (variants.includes(href)) return true
  return href.endsWith(`/${slug}`) || href.endsWith(`/${slug}/`) || href.endsWith(`/${slug}.html`)
}

function analyze(pages: Page[]) {
  const home = pages.find(p => p.slug === 'home') ?? pages[0]
  if (!home) return { error: 'no home page' as const }

  const navMatch = home.html.match(/<nav[\s\S]*?<\/nav>/i)
  if (!navMatch) return { error: 'no <nav> in home page' as const, homeSlug: home.slug }

  const navHtml = navMatch[0]
  const items = parseNavItems(navHtml)

  const pagesInMenu = pages.filter(p => p.inMenu !== false && p.slug !== 'home')

  const missing: { slug: string; name: string; menuLabel?: string }[] = []
  for (const p of pagesInMenu) {
    const found = items.some(it => matchesSlug(it.href, p.slug))
    if (!found) missing.push({ slug: p.slug, name: p.name ?? p.slug, menuLabel: p.menuLabel })
  }

  return {
    homeSlug: home.slug,
    totalPages: pages.length,
    pagesInMenuCount: pagesInMenu.length,
    navItemCount: items.length,
    navItems: items,
    missingPages: missing,
    allPages: pages.map(p => ({ slug: p.slug, name: p.name, inMenu: p.inMenu !== false })),
    navHtmlPreview: navHtml.length > 800 ? navHtml.slice(0, 800) + '…' : navHtml,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 })

  const supabase = getSupabase()
  const { data: project, error } = await supabase
    .from('projects').select('user_id, site_config').eq('id', projectId).single()
  if (error || !project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (project.user_id !== user.id) return NextResponse.json({ error: 'not yours' }, { status: 403 })

  const pages = (project.site_config?.pages ?? []) as Page[]
  const analysis = analyze(pages)

  // Also check blog_posts (served from a separate table, not in pages array)
  const { data: posts, error: postsErr } = await supabase
    .from('blog_posts')
    .select('id, slug, title, status, published_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  // Detect whether the navbar links to /blog
  const home = pages.find(p => p.slug === 'home') ?? pages[0]
  const navMatch = home?.html.match(/<nav[\s\S]*?<\/nav>/i)
  const navHtml = navMatch ? navMatch[0] : ''
  const items = parseNavItems(navHtml)
  const blogInNav = items.some(it => /\/blog(\/|$|\?|#|\b)/i.test(it.href) || it.href === './blog' || it.href === 'blog')

  return NextResponse.json({
    ...analysis,
    blog: {
      postsCount: posts?.length ?? 0,
      posts: posts ?? [],
      postsQueryError: postsErr?.message ?? null,
      blogLinkInNav: blogInNav,
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 })

  const supabase = getSupabase()
  const { data: project, error } = await supabase
    .from('projects').select('user_id, site_config').eq('id', projectId).single()
  if (error || !project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (project.user_id !== user.id) return NextResponse.json({ error: 'not yours' }, { status: 403 })

  const config = project.site_config ?? {}
  const pages = (config.pages ?? []) as Page[]
  const diag = analyze(pages)
  if ('error' in diag) return NextResponse.json({ ok: false, diag }, { status: 400 })
  if (diag.missingPages.length === 0) return NextResponse.json({ ok: true, message: 'nothing to fix', diag })

  // Inject missing pages as <li><a> entries inside every page's <nav>'s first <ul>.
  // If no <ul> is found, append just before </nav>.
  const newNavItemsHtml = diag.missingPages.map(p => {
    const label = p.menuLabel ?? p.name ?? p.slug
    const href = `./${p.slug}`
    return `<li><a href="${href}">${label}</a></li>`
  }).join('')

  const navUlRe = /(<nav[\s\S]*?<ul[\s\S]*?)(<\/ul>[\s\S]*?<\/nav>)/i
  const navCloseRe = /(<nav[\s\S]*?)(<\/nav>)/i

  const newPages = pages.map(p => {
    if (navUlRe.test(p.html)) {
      return { ...p, html: p.html.replace(navUlRe, `$1${newNavItemsHtml}$2`) }
    }
    if (navCloseRe.test(p.html)) {
      return { ...p, html: p.html.replace(navCloseRe, `$1${newNavItemsHtml}$2`) }
    }
    return p
  })

  const newConfig = { ...config, pages: newPages }
  const { error: updErr } = await supabase
    .from('projects').update({ site_config: newConfig, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    added: diag.missingPages,
    message: `Re-added ${diag.missingPages.length} pages to nav across ${newPages.length} pages`,
  })
}
