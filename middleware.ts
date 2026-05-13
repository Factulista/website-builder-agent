import { NextRequest, NextResponse } from 'next/server'

const ROOT_DOMAIN = 'factulista.com'
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

  // Pass-through for main domain and www
  if (
    host === ROOT_DOMAIN ||
    host === `www.${ROOT_DOMAIN}`
  ) {
    return NextResponse.next()
  }

  // Skip API and Next internals for all hosts
  const path = url.pathname
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next()
  }

  // Check if this is a custom domain (not factulista.com subdomain)
  if (!host.endsWith(ROOT_DOMAIN)) {
    // Custom domain - rewrite to API handler that will lookup the project
    url.pathname = `/api/serve-custom-domain${path}`
    url.searchParams.set('host', host)
    return NextResponse.rewrite(url)
  }

  // If we reach here, it's a factulista.com subdomain - just pass through
  // The app will handle myweb.factulista.com/slug routing normally
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
