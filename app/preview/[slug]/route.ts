import { servePreview } from '../../../lib/preview'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return servePreview(slug, 'home')
}
