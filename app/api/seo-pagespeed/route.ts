import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const key = process.env.GOOGLE_PAGESPEED_API_KEY
  if (!key) {
    return NextResponse.json({
      error: 'GOOGLE_PAGESPEED_API_KEY non configurata',
      hint: 'Ottieni la chiave gratis su https://developers.google.com/speed/docs/insights/v5/get-started',
    }, { status: 200 })
  }

  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${key}`
    const r = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) })
    if (!r.ok) {
      const err = await r.text()
      console.error('[pagespeed] API error', r.status, err)
      return NextResponse.json({ error: `PageSpeed API: ${r.status}` }, { status: 200 })
    }
    const data = await r.json()
    const cats = data.lighthouseResult?.categories
    const audits = data.lighthouseResult?.audits
    const score = Math.round((cats?.performance?.score ?? 0) * 100)
    const fcp  = audits?.['first-contentful-paint']?.displayValue ?? '—'
    const lcp  = audits?.['largest-contentful-paint']?.displayValue ?? '—'
    const tti  = audits?.['interactive']?.displayValue ?? '—'
    const cls  = audits?.['cumulative-layout-shift']?.displayValue ?? '—'
    const tbt  = audits?.['total-blocking-time']?.displayValue ?? '—'
    return NextResponse.json({ score, fcp, lcp, tti, cls, tbt })
  } catch (err) {
    console.error('[pagespeed]', err)
    return NextResponse.json({ error: 'Errore durante l\'analisi PageSpeed' }, { status: 200 })
  }
}
