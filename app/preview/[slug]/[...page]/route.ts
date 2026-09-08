import { servePreview, servePublished } from '../../../../lib/preview'

export const runtime = 'nodejs'

// Catch-all (was a single [page] segment): pages can live at nested slugs like
// "autonomos/programa-de-facturacion-para-abogados" — a plain [page] segment can
// only ever match one path component, so any 2+-level slug 404'd before this
// handler even ran, on both myweb (preview) and www/custom domains (published).
// Joining the segments back with '/' reproduces the exact slug stored in
// site_config.pages / published_pages, so servePreview/servePublished need no changes.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; page: string[] }> }) {
  const { slug, page } = await params
  const pageSlug = (page ?? []).join('/')
  const originalHost = req.headers.get('x-original-host') ?? undefined
  if (originalHost) return servePublished(slug, pageSlug, originalHost)
  return servePreview(slug, pageSlug)
}
