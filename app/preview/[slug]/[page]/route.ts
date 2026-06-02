import { servePreview } from '../../../../lib/preview'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page } = await params
  const originalHost = req.headers.get('x-original-host') ?? undefined
  return servePreview(slug, page, originalHost)
}
