import { servePreview, servePublished } from '../../../../lib/preview'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page } = await params
  const originalHost = req.headers.get('x-original-host') ?? undefined
  if (originalHost) return servePublished(slug, page, originalHost)
  return servePreview(slug, page)
}
