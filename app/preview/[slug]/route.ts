import { servePreview, servePublished } from '../../../lib/preview'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const originalHost = req.headers.get('x-original-host') ?? undefined
  // When served at the real public domain (www.factulista.com), use published_pages
  // so the "Publish" button in the editor controls what goes live — same staging vs
  // production separation as custom domains. myweb.factulista.com still uses
  // servePreview (always latest draft) for editing feedback.
  if (originalHost) return servePublished(slug, 'home', originalHost)
  return servePreview(slug, 'home')
}
