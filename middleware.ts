import { NextRequest, NextResponse } from 'next/server'

const ROOT_DOMAIN = 'factulista.com'

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase()
  const url = req.nextUrl.clone()

  // Pass-through for vercel.app preview deployments and the apex/root domain
  if (
    host.endsWith('.vercel.app') ||
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === ROOT_DOMAIN ||
    host === `www.${ROOT_DOMAIN}`
  ) {
    return NextResponse.next()
  }

  // Match a project subdomain: {slug}.factulista.com
  const match = host.match(new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${ROOT_DOMAIN.replace('.', '\\.')}$`))
  if (!match) return NextResponse.next()

  const projectSlug = match[1]
  const path = url.pathname

  // Skip API and Next internals
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path === '/favicon.ico') {
    return NextResponse.next()
  }

  // Rewrite "/" → "/preview/{slug}", "/about" → "/preview/{slug}/about"
  if (path === '/' || path === '') {
    url.pathname = `/preview/${projectSlug}`
  } else {
    url.pathname = `/preview/${projectSlug}${path}`
  }
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
