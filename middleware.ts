import { NextRequest, NextResponse } from 'next/server'

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
const PREVIEW_SUBDOMAIN = 'myweb'

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase()
  const url = req.nextUrl.clone()

  // Pass-through for vercel.app preview deployments and localhost
  if (
    host.endsWith('.vercel.app') ||
    host === 'localhost' ||
    host.startsWith('localhost:')
  ) {
    return NextResponse.next()
  }

  // www.factulista.com → serve the published site of the root project
  // ROOT_DOMAIN_PROJECT env var controls which project slug is served at the root domain.
  // We pass x-original-host so servePreview can build base href / siteUrl with the
  // real public domain instead of myweb.factulista.com — otherwise internal nav links
  // would redirect users from www.factulista.com to myweb.factulista.com on every click.
  if (host === `www.${ROOT_DOMAIN}`) {
    const rootProject = process.env.ROOT_DOMAIN_PROJECT ?? ''
    if (rootProject) {
      const requestHeaders = new Headers(req.headers)
      requestHeaders.set('x-original-host', host)

      // Intercept sitemap.xml and robots.txt — route them to /api/seo-files with the
      // correct slug and a host param so the API builds the right canonical base URL.
      if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
        const fileParam = url.pathname.slice(1) // 'sitemap.xml' or 'robots.txt'
        url.pathname = '/api/seo-files'
        url.searchParams.set('slug', rootProject)
        url.searchParams.set('file', fileParam)
        url.searchParams.set('host', host)
        return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
      }

      const rewritePath = url.pathname === '/' || url.pathname === ''
        ? `/preview/${rootProject}`
        : `/preview/${rootProject}${url.pathname}`
      url.pathname = rewritePath
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
    return NextResponse.next()
  }

  // Apex domain (factulista.com without www) → redirect to www
  if (host === ROOT_DOMAIN) {
    const wwwUrl = url.clone()
    wwwUrl.host = `www.${ROOT_DOMAIN}`
    return NextResponse.redirect(wwwUrl, 308)
  }

  // Skip API and Next internals for all hosts
  const path = url.pathname
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next()
  }

  // Handle myweb.factulista.com/{slug}/{page?} → /preview/{slug}/{page?}
  // But let app routes pass through (login, projects, preview, api)
  const APP_ROUTES = ['/login', '/projects', '/api', '/_next', '/back-office']
  if (host === `${PREVIEW_SUBDOMAIN}.${ROOT_DOMAIN}`) {
    const segments = path.split('/').filter(Boolean)

    // Redirect any leaked /preview/{slug}/... to the clean /{slug}/... URL.
    // This can happen from cached pages or old bookmarks that used the old base href.
    if (path.startsWith('/preview/') && segments.length >= 2) {
      const cleanPath = '/' + segments.slice(1).join('/')
      const cleanUrl = url.clone()
      cleanUrl.pathname = cleanPath
      return NextResponse.redirect(cleanUrl, 301)
    }

    if (segments.length === 0 || APP_ROUTES.some(r => path.startsWith(r))) {
      return NextResponse.next()
    }
    const [slug, ...rest] = segments
    const page = rest[0]
    // Serve SEO files directly via API (not as preview pages)
    if (page === 'sitemap.xml' || page === 'robots.txt') {
      url.pathname = '/api/seo-files'
      url.searchParams.set('slug', slug)
      url.searchParams.set('file', page)
      return NextResponse.rewrite(url)
    }
    // Preserve ALL path segments after the project slug (handles blog/{post}, blog/{cat}/{post}, etc.)
    url.pathname = rest.length > 0 ? `/preview/${slug}/${rest.join('/')}` : `/preview/${slug}`
    return NextResponse.rewrite(url)
  }

  // Custom domain (not factulista.com subdomain) → serve published site
  if (!host.endsWith(ROOT_DOMAIN)) {
    url.pathname = `/api/serve-custom-domain${path}`
    url.searchParams.set('host', host)
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
