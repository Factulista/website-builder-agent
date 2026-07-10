/**
 * "Share this page" links injected at the bottom-left of every footer —
 * X, Facebook, LinkedIn (Instagram has no web share-intent for arbitrary
 * URLs, so it's intentionally omitted). Uses the page's own URL/title so
 * each page shares itself, not the homepage.
 */

/**
 * Footer content is almost always a centered column narrower than the
 * <footer> element itself (e.g. .footer-grid/.footer-bottom { max-width:
 * 1200px; margin: 0 auto }). Our block is appended as a direct child of
 * <footer>, so without matching that same max-width + centering it aligns
 * to the padded edge of <footer> instead of the visible content column
 * above it — looking "off" relative to the rest of the footer. Detect the
 * site's own footer column width so we match it instead of guessing.
 */
function detectFooterContentWidth(html: string): string {
  const m = html.match(/\.footer[\w-]*\s*\{[^}]*max-width:\s*(\d+px)[^}]*\}/i)
  return m?.[1] ?? '1200px'
}

export function buildSocialShareBlock(pageUrl: string, pageTitle: string, contentMaxWidth = '1200px'): string {
  const encodedUrl = encodeURIComponent(pageUrl)
  const encodedTitle = encodeURIComponent(pageTitle)
  return `
<div class="fact-share-links-wrap">
  <div class="fact-share-links" role="group" aria-label="Condividi questa pagina">
    <a href="https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}" target="_blank" rel="noopener noreferrer" aria-label="Condividi su X">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" target="_blank" rel="noopener noreferrer" aria-label="Condividi su Facebook">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12.06C22 6.505 17.523 2 12 2S2 6.505 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.508 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.462h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.438-4.92 8.438-9.94z"/></svg>
    </a>
    <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}" target="_blank" rel="noopener noreferrer" aria-label="Condividi su LinkedIn">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.114 20.452H3.558V9h3.556v11.452z"/></svg>
    </a>
  </div>
</div>
<style>
.fact-share-links-wrap{max-width:${contentMaxWidth} !important;width:auto !important;margin:0 auto !important;padding:0 !important;position:static !important;float:none !important}
.fact-share-links{display:flex !important;gap:14px !important;align-items:center !important;justify-content:flex-start !important;margin:20px 0 0 !important;padding:0 !important;width:auto !important;position:static !important;float:none !important}
.fact-share-links a{display:inline-flex !important;align-items:center !important;justify-content:center !important;width:32px !important;height:32px !important;color:inherit !important;opacity:0.75 !important;transition:opacity .15s ease !important;text-decoration:none !important;background:none !important;border:none !important}
.fact-share-links a:hover{opacity:1 !important}
.fact-share-links svg{width:18px !important;height:18px !important;display:block !important}
</style>`
}

/** Inserts the share-links block as the last child of <footer>. No-op if no footer exists. */
export function injectSocialShareLinks(html: string, pageUrl: string, pageTitle: string): string {
  if (!/<\/footer>/i.test(html)) return html
  const contentMaxWidth = detectFooterContentWidth(html)
  const block = buildSocialShareBlock(pageUrl, pageTitle, contentMaxWidth)
  return html.replace(/<\/footer>/i, `${block}\n</footer>`)
}
