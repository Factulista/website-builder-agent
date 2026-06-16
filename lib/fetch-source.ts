/**
 * Fetch a web page and extract its main readable text — used to give the blog
 * generator reference material from a link. Strips scripts/styles/nav/footer/header
 * and tags, decodes entities, collapses whitespace, and caps the length so a single
 * source can't blow up the token budget.
 */
export async function fetchSourceText(url: string, maxChars = 8000): Promise<{ url: string; text: string } | null> {
  try {
    // Basic URL sanity
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FactulistaBot/1.0; +https://factulista.com)' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null

    const html = await res.text()
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#8217;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) return null
    if (text.length > maxChars) text = text.slice(0, maxChars) + '…'
    return { url, text }
  } catch {
    return null
  }
}

/** Fetch multiple sources (in parallel, capped count) and return a prompt-ready block. */
export async function buildSourcesBlock(urls: string[], maxSources = 3, maxCharsEach = 7000): Promise<string> {
  const clean = urls.map(u => u.trim()).filter(Boolean).slice(0, maxSources)
  if (clean.length === 0) return ''
  const results = await Promise.all(clean.map(u => fetchSourceText(u, maxCharsEach)))
  const ok = results.filter((r): r is { url: string; text: string } => !!r)
  if (ok.length === 0) return ''
  return ok.map((s, i) => `--- FONTE ${i + 1} (${s.url}) ---\n${s.text}`).join('\n\n')
}
