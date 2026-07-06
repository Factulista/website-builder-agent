import { FRAME_GLOBAL_FIX } from './shared-frame'
import { resolveNfdIcon } from './components/index'

export type MegaPage = { slug: string; name: string; menuLabel?: string; megaMenuLabel?: string; megaMenuIcon?: string }

const MEGA_MENU_CSS = `.comp-nfd-trigger{color:#737373!important;font-size:16px!important;font-weight:500!important;}.comp-nfd-panel{max-width:min(95vw,780px)!important;}.comp-nfd[data-open="true"] .comp-nfd-panel,.comp-nfd-panel[data-count]{grid-template-columns:repeat(2,1fr)!important;}.comp-nfd-item{color:#737373!important;white-space:nowrap!important;font-weight:500!important;text-decoration:none!important;display:flex!important;align-items:center!important;gap:10px!important;padding:10px 14px!important;border-radius:8px!important;}.comp-nfd-item:hover{background:#f5f5f5!important;}.comp-nfd-label{color:#737373!important;font-size:14px!important;}.comp-nfd-icon{color:#111!important;opacity:0.75!important;flex-shrink:0!important;width:20px!important;height:20px!important;display:flex!important;align-items:center!important;justify-content:center!important;}.comp-nfd-icon svg{width:20px!important;height:20px!important;}.footer-links a:hover{color:#fbbf24!important;}`

function megaLabel(p: MegaPage): string {
  const raw = p.megaMenuLabel ?? p.menuLabel ?? p.name
  return raw.includes('|') ? raw.split('|').pop()!.trim() : raw
}

function rebuildMegaMenuPanel(html: string, megaPages: MegaPage[]): string {
  if (!megaPages.length) return html
  const items = megaPages.map(p => {
    const label = megaLabel(p)
    const iconSvg = resolveNfdIcon(p.megaMenuIcon ?? '')
    return `<a href="./${p.slug}" class="comp-nfd-item" role="menuitem"><span class="comp-nfd-icon" aria-hidden="true">${iconSvg}</span><span class="comp-nfd-label">${label}</span></a>`
  }).join('\n      ')
  return html.replace(
    /(<div class="comp-nfd-panel"[^>]*)(>)[\s\S]*?(<\/div>)/,
    `$1 data-count="${megaPages.length}"$2\n      ${items}\n  $3`
  )
}

/**
 * Named injection slots — points in the rendered HTML where arbitrary content
 * can be injected without touching page HTML directly.
 *
 * - head            → inserted inside <head> of every page and blog page
 * - body_end        → inserted before </body> of every page and blog page
 * - blog_post_bottom → inserted after </article> in each blog post
 * - blog_list_bottom → inserted after the article grid in the blog listing
 */
export type InjectSlot = 'head' | 'body_end' | 'blog_post_bottom' | 'blog_list_bottom'
export type InjectPoints = Partial<Record<InjectSlot, string>>

/**
 * HTML-escape a string for safe interpolation into element text or attribute values.
 * Use for ALL user-controlled values that end up in href/src/alt/content/title etc.
 * Do NOT use on intentionally-rendered HTML (e.g. post.content_html).
 */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Safe URL for href/src — rejects javascript:, data:, vbscript: schemes */
export function safeUrl(s: unknown): string {
  const str = String(s ?? '').trim()
  if (!str) return '#'
  // Allow relative, absolute http(s), mailto, tel, anchor
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(str)) return escapeHtml(str)
  // Auto-prepend https:// for bare domain-style URLs (e.g. factulista.com, www.example.com)
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}/.test(str)) return escapeHtml('https://' + str)
  // Reject everything else (javascript:, data:, vbscript:, etc.)
  return '#'
}

/** CSS for individual blog post content — shared between server render and editor preview */
export const BLOG_POST_CONTENT_CSS = `
  /* ── Breadcrumb (above post header) ──
     !important hardening: tenant CSS may have aggressive generic selectors
     (div/nav resets, fixed headers) injected before this block. */
  .blog-breadcrumb{position:static !important;width:auto !important;max-width:100% !important;height:auto !important;background:transparent !important;box-shadow:none !important;border:none !important;padding:0 !important;font-size:.8rem !important;color:#9ca3af !important;margin:0 0 1.1rem !important;display:flex !important;align-items:center !important;justify-content:flex-start !important;flex-wrap:nowrap !important;overflow:hidden !important;white-space:nowrap !important;z-index:auto !important}
  .blog-breadcrumb a{color:#6b7280 !important;text-decoration:none !important;flex-shrink:0 !important;padding:0 !important;margin:0 !important;background:transparent !important;font-size:.8rem !important;font-weight:400 !important}
  .blog-breadcrumb a:hover{text-decoration:underline !important}
  .blog-breadcrumb .bc-sep{margin:0 .45rem !important;color:#d1d5db !important;flex-shrink:0 !important}
  .blog-breadcrumb [aria-current]{overflow:hidden !important;text-overflow:ellipsis !important;min-width:0 !important;color:#9ca3af !important;font-size:.8rem !important}

  /* ── Layout 3 colonne ─────────────────────────────────────────────────
     Heavy !important defenses below — the site's own CSS (extracted from
     home page <style>) gets injected BEFORE this block and often has
     aggressive selectors like \`nav { display:flex }\` or container resets
     that break the post layout. */
  .blog-post-layout{
    display:grid !important;
    grid-template-columns:260px minmax(0,1fr) 260px !important;
    gap:2.5rem !important;
    max-width:1320px !important;
    width:100% !important;
    margin:0 auto !important;
    /* 4.5rem top: tenant navs are commonly position:fixed (~56-70px tall) and would
       otherwise cover the first in-flow elements (breadcrumb, TOC back link). */
    padding:4.5rem 1.5rem 5rem !important;
    align-items:start !important;
    box-sizing:border-box !important;
    background:transparent !important;
  }
  .blog-post-layout, .blog-post-layout *{box-sizing:border-box}
  /* ── TOC (sinistra) ──────────────────────────────────────────────── */
  .blog-toc{
    display:block !important;
    position:sticky !important;
    top:5rem !important;
    width:100% !important;
    margin:0 !important;
    padding:0 !important;
    background:transparent !important;
    border:none !important;
    font-family:inherit;
  }
  .blog-toc-back{
    display:inline-flex !important;
    align-items:center;
    gap:6px;
    font-size:.82rem !important;
    font-weight:600 !important;
    color:#b45309 !important;
    text-decoration:none !important;
    margin:0 0 1.4rem !important;
    padding:0 !important;
    background:transparent !important;
    border:none !important;
    line-height:1.3 !important;
  }
  .blog-toc-back:hover{text-decoration:underline !important;color:#92400e !important}
  .blog-toc-title{
    font-size:.72rem !important;
    font-weight:700 !important;
    color:#9b9896 !important;
    text-transform:uppercase !important;
    letter-spacing:.08em !important;
    margin:0 0 .85rem !important;
    padding:0 !important;
    line-height:1.3 !important;
  }
  .blog-toc-list{
    list-style:none !important;
    margin:0 !important;
    padding:0 !important;
    border-left:2px solid #fde68a !important;
    display:block !important;
    background:transparent !important;
  }
  .blog-toc-list li{
    margin:0 0 1px !important;
    padding:0 !important;
    display:block !important;
    list-style:none !important;
  }
  .blog-toc-list a{
    display:block !important;
    padding:.45rem .9rem !important;
    font-size:.82rem !important;
    color:#6b6563 !important;
    text-decoration:none !important;
    border-left:2px solid transparent !important;
    border-top:none !important;border-right:none !important;border-bottom:none !important;
    margin-left:-2px !important;
    line-height:1.45 !important;
    transition:color .15s,border-color .15s;
    background:transparent !important;
    font-weight:400 !important;
    text-transform:none !important;
    letter-spacing:normal !important;
  }
  .blog-toc-list a:hover{color:#b45309 !important}
  .blog-toc-list a.toc-active{
    color:#b45309 !important;
    font-weight:600 !important;
    border-left-color:#f59e0b !important;
  }
  /* ── Content (centro) ───────────────────────────────────────────── */
  .blog-post-wrapper{min-width:0 !important;width:100% !important;max-width:none !important;margin:0 !important;padding:0 !important;background:transparent !important}
  .blog-post-header{margin:0 0 2rem !important;padding:0 !important}
  .blog-post-meta{font-size:.78rem;color:#888;margin-bottom:.7rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .blog-tag{background:#f3f4f6;color:#374151;font-size:.68rem;padding:2px 8px;border-radius:20px;font-weight:600}
  /* .blog-post-header h1: margin/layout stay !important (structural).
     font-size/weight/color/line-height: NO !important → Design System can override via :where() + sharedCss */
  .blog-post-header h1{font-size:2.4rem;font-weight:800;line-height:1.2;margin:0 0 .85rem !important;color:#1a1a1a}
  .blog-post-excerpt-box{
    background:#fffbeb;
    border-left:4px solid #f59e0b;
    border-radius:0 10px 10px 0;
    padding:16px 20px;
    margin:0 0 2rem !important;
  }
  .blog-post-excerpt-box p{
    margin:0 !important;
    font-size:1rem;
    line-height:1.7;
    color:#78350f;
    font-style:italic;
  }
  .post-featured-img{width:100% !important;border-radius:14px !important;margin:1.75rem 0 2.25rem !important;max-height:460px !important;object-fit:cover !important;display:block !important}
  .blog-post-content{font-size:1.05rem;line-height:1.8;color:#1a1a1a}
  /* h1-h4: margin + scroll-margin stay !important (structural/UX).
     font-size, font-weight, color, line-height: NO !important → Design System wins */
  .blog-post-content h1{font-size:2rem;font-weight:800;margin:2.75rem 0 .85rem !important;scroll-margin-top:5.5rem !important;color:#1a1a1a;line-height:1.25}
  .blog-post-content h2{font-size:1.6rem;font-weight:700;margin:2.75rem 0 .85rem !important;scroll-margin-top:5.5rem !important;color:#1a1a1a;line-height:1.3}
  .blog-post-content h3{font-size:1.25rem;font-weight:600;margin:2rem 0 .6rem !important;scroll-margin-top:5.5rem !important;color:#1a1a1a;line-height:1.35}
  .blog-post-content h4{font-size:1.05rem;font-weight:600;margin:1.5rem 0 .5rem !important;color:#1a1a1a}
  /* p: margin stays !important (structural). font-size/line-height/color: NO !important.
     Note: span-level font-size overrides from editor still work (target child <span>). */
  /* p, div and li: same base font-size and color.
     div is used by old AI content instead of p — must always match.
     li children: force inherit to neutralise old inline style remnants. */
  .blog-post-content p,.blog-post-content>div{font-size:1rem;line-height:1.7;margin:0 0 1.25rem;color:#1a1a1a}
  .blog-post-content li{font-size:1rem;margin-bottom:.45rem !important;line-height:1.7;color:#1a1a1a}
  .blog-post-content li span,.blog-post-content li b,.blog-post-content li strong{font-size:inherit !important;color:inherit !important}
  /* ul: custom small bullet centred with text line */
  .blog-post-content ul{list-style:none !important;margin:0 0 1.35rem !important;padding-left:1.75rem !important}
  .blog-post-content ul>li{position:relative;padding-left:.05em}
  /* Bullet: symbol/size overridden by Design System dsOverride block */
  .blog-post-content ul>li::before{
    content:"•";font-size:.65em;
    position:absolute;left:-1.1em;
    top:50%;transform:translateY(-50%);
    line-height:1;color:currentColor;
  }
  /* ol keeps decimal numbering */
  .blog-post-content ol{list-style:decimal;margin:0 0 1.35rem !important;padding-left:1.75rem !important}
  /* When browsers apply insertUnorderedList/insertOrderedList on block content
     they often wrap it as <li><p>text</p></li> or <li><h1>text</h1></li>.
     JS unwraps these on creation, but this CSS is a safety net for saved content.
     - <p> inside <li>: remove the bottom margin that causes huge item gaps
     - <h*> inside <li>: reset size/weight so items look like normal list text
     - <div> inside <li>: same treatment as <p> */
  .blog-post-content li > p,
  .blog-post-content li > div{
    margin:0 !important;display:inline !important;
  }
  .blog-post-content li h1,.blog-post-content li h2,
  .blog-post-content li h3,.blog-post-content li h4,
  .blog-post-content li h5,.blog-post-content li h6{
    font-size:inherit !important;font-weight:inherit !important;
    line-height:1.7 !important;margin:0 !important;padding:0 !important;
    display:inline !important;
  }
  /* ol marker size — inherits from li, no override needed */
  /* ── Special blocks (class-only, no inline style) ───────────────── */
  .blog-post-content .article-summary{
    background:#fffbeb;border-left:4px solid #f59e0b;
    border-radius:0 10px 10px 0;padding:14px 18px;margin:1.5rem 0;
  }
  .blog-post-content .article-summary p{margin:0 !important;color:#78350f;font-style:italic}
  .blog-post-content .key-takeaways{
    background:#fffbeb;border:1px solid #fde68a;
    border-radius:10px;padding:16px 20px;margin:1.5rem 0;
  }
  .blog-post-content .key-takeaways strong{color:#92400e;display:block;margin-bottom:.5rem}
  .blog-post-content .key-takeaways ul{margin:.5rem 0 0 !important;padding-left:1.2rem !important}
  .blog-post-content .callout{
    background:#fffbeb;border-left:4px solid #f59e0b;
    border-radius:0 8px 8px 0;padding:12px 16px;margin:1.25rem 0;
  }
  .blog-post-content .callout strong{color:#92400e}
  .blog-post-content .cta-box{
    background:#92400e;color:#fff;
    padding:28px 24px;margin:2rem 0;border-radius:14px;text-align:center;
  }
  .blog-post-content .cta-box h3{color:#fff !important;margin:0 0 8px !important;font-size:1.3rem}
  .blog-post-content .cta-box p{margin:0 0 16px !important;opacity:.9;color:#fff}
  .blog-post-content .cta-box a{
    display:inline-block;background:#fff;color:#92400e;
    padding:10px 26px;border-radius:50px;font-weight:700;text-decoration:none;
    transition:opacity .15s;
  }
  .blog-post-content .cta-box a:hover{opacity:.88}
  .blog-post-content img{max-width:100% !important;height:auto !important;border-radius:10px !important;margin:1.75rem 0 !important;display:block}
  .blog-post-content a{color:var(--color-accent,#2563eb) !important;text-decoration:underline}
  .blog-post-content blockquote{border-left:4px solid var(--color-accent,#2563eb);margin:1.75rem 0;padding:.85rem 1.35rem;background:#f8f9ff;border-radius:0 8px 8px 0;font-style:italic;color:#444}
  .blog-post-content pre{background:#1a1a1a;color:#f8f8f8;border-radius:10px;padding:1.25rem;overflow-x:auto;font-size:.88rem;margin:1.5rem 0}
  .blog-post-content code{font-family:'Fira Code',monospace;font-size:.88em;background:#f3f4f6;padding:2px 5px;border-radius:4px}
  .blog-post-content pre code{background:none;padding:0}
  .blog-post-content table{border-collapse:collapse;width:100%;margin:1.5rem 0;font-size:.95rem}
  .blog-post-content table th,.blog-post-content table td{border:1px solid #e5e7eb;padding:8px 12px;text-align:left}
  .blog-post-content table th{background:#f9fafb;font-weight:600}
  .blog-post-author{font-size:.75rem;color:#666;font-style:italic}
  /* ── Banner (destra) ────────────────────────────────────────────── */
  .blog-sidebar-right{
    display:block !important;
    position:sticky !important;
    top:5rem !important;
    width:100% !important;
    margin:0 !important;
    padding:0 !important;
    background:transparent !important;
    border:none !important;
  }
  .blog-sidebar-banner{display:block !important;border-radius:12px;overflow:hidden;border:1px solid #e8e4de;transition:box-shadow .2s,transform .2s;text-decoration:none !important;pointer-events:auto !important;cursor:pointer !important}
  .blog-sidebar-banner:hover{box-shadow:0 6px 20px rgba(0,0,0,.1);transform:translateY(-2px)}
  .blog-sidebar-banner img{width:100% !important;height:auto !important;display:block !important;margin:0 !important;border-radius:0 !important}
  /* ── Responsive ─────────────────────────────────────────────────── */
  @media(max-width:1180px){
    .blog-post-layout{grid-template-columns:230px minmax(0,1fr) !important;gap:2rem !important;max-width:1000px !important}
    .blog-sidebar-right{display:none !important}
  }
  @media(max-width:820px){
    .blog-post-layout{grid-template-columns:1fr !important;padding:4.25rem 1.1rem 3rem !important;gap:1.25rem !important}
    .blog-toc{position:static !important;border:1px solid #e8e4de !important;border-radius:12px !important;padding:1rem 1.1rem !important;background:#fafaf9 !important}
    .blog-post-header h1{font-size:1.85rem !important}
    .blog-post-content{font-size:1rem}
  }
`

export type Post = {
  id: string
  title: string
  slug: string
  excerpt: string
  featured_image: string | null
  published_at: string | null
  categories: string[]
  tags: string[]
  content_html: string
  seo_title: string | null
  seo_description: string | null
  author?: string
}

/**
 * Selects related posts for an article.
 * Priority: manual picks (in chosen order) → same-category posts → most recent.
 * `candidates` should already be the published posts (any order); the current post
 * is excluded automatically. Returns up to `limit` posts.
 */
export function pickRelatedPosts(
  candidates: Post[],
  current: { id: string; categories?: string[] },
  manualIds?: string[],
  limit = 6,
): Post[] {
  const pool = candidates.filter(p => p.id !== current.id)
  const cats = new Set(current.categories ?? [])
  const byCategory = (list: Post[]) => {
    const same = list.filter(p => (p.categories ?? []).some(c => cats.has(c)))
    const others = list.filter(p => !(p.categories ?? []).some(c => cats.has(c)))
    return [...same, ...others]
  }
  if (manualIds && manualIds.length) {
    const byId = new Map(pool.map(p => [p.id, p]))
    const manual = manualIds.map(id => byId.get(id)).filter((p): p is Post => !!p)
    if (manual.length >= limit) return manual.slice(0, limit)
    const chosen = new Set(manual.map(p => p.id))
    const rest = byCategory(pool.filter(p => !chosen.has(p.id)))
    return [...manual, ...rest].slice(0, limit)
  }
  return byCategory(pool).slice(0, limit)
}

export type BlogSidebarBanner = {
  url: string
  link: string
}

/**
 * Rewrites relative nav links (href="./slug") to absolute (href="baseUrl/slug").
 * Blog pages are served at /blog/category/post depth, so relative links resolve wrong.
 */
function fixNavLinks(nav: string, baseUrl: string): string {
  return nav.replace(/href="\.\//g, `href="${baseUrl}/`)
}

function slugifySimple(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function formatDate(iso: string | null, lang = 'it'): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(
      lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-US' : 'it-IT',
      { year: 'numeric', month: 'long', day: 'numeric' }
    )
  } catch { return '' }
}

/** Extracts H2 headings, injects unique IDs, returns enriched content + TOC items */
function buildTocFromContent(contentHtml: string): {
  contentWithIds: string
  tocItems: { id: string; text: string }[]
} {
  let counter = 0
  const tocItems: { id: string; text: string }[] = []
  const decodeEntities = (s: string) => s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim()

  const contentWithIds = contentHtml.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (_, attrs, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ''))
    if (/\bid=/.test(attrs)) {
      const existingId = attrs.match(/\bid=["']([^"']+)["']/)?.[1]
      if (existingId) {
        tocItems.push({ id: existingId, text })
        return `<h2${attrs}>${inner}</h2>`
      }
    }
    const id = `s${counter++}`
    tocItems.push({ id, text })
    return `<h2${attrs} id="${id}">${inner}</h2>`
  })
  return { contentWithIds, tocItems }
}

export function buildBlogListPage(
  posts: Post[],
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'it',
  headerHtml = '',
  currentPage = 1,
  totalPages = 1,
  faviconUrl?: string,
  injectPoints?: InjectPoints,
  megaPages?: MegaPage[],
  seoTitle?: string,
  seoDescription?: string
): string {
  const subtitle = lang === 'es' ? 'Artículos y novedades' : lang === 'en' ? 'Articles and updates' : 'Articoli e aggiornamenti'
  // SEO <title> / meta description: use the per-site overrides when provided,
  // else fall back to the generic defaults (so the tag is never empty/too short).
  const title = seoTitle?.trim() || 'Blog'
  const metaDescription = seoDescription?.trim() || subtitle
  const readMoreLabel = lang === 'es' ? 'Leer más →' : lang === 'en' ? 'Read more →' : 'Leggi →'

  const cards = posts.map(post => {
    const img = post.featured_image
      ? `<img class="blog-card-img" src="${safeUrl(post.featured_image)}" alt="${escapeHtml(post.title)}" loading="lazy">`
      : ''
    const firstCat = (post.categories ?? [])[0]
    const catSlug = firstCat ? slugifySimple(firstCat) : null
    const postHref = catSlug ? `${baseUrl}/blog/${catSlug}/${post.slug}` : `${baseUrl}/blog/${post.slug}`
    const catTag = firstCat ? `<span class="blog-tag blog-tag-cat">${escapeHtml(firstCat)}</span>` : ''
    const dateStr = escapeHtml(formatDate(post.published_at, lang))
    const authorStr = post.author ? `<span class="blog-card-author">${escapeHtml(post.author)}</span>` : ''
    return `<article class="blog-card">
  ${img}
  <div class="blog-card-body">
    ${catTag ? `<div class="blog-card-cats">${catTag}</div>` : ''}
    <div class="blog-card-meta">${dateStr}</div>
    <h2 class="blog-card-title"><a href="${escapeHtml(postHref)}">${escapeHtml(post.title)}</a></h2>
    ${post.excerpt ? `<p class="blog-card-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
    <div class="blog-card-footer">
      <a class="blog-read-more" href="${escapeHtml(postHref)}">${readMoreLabel}</a>
      ${authorStr}
    </div>
  </div>
</article>`
  }).join('\n')

  const emptyState = posts.length === 0
    ? `<p style="color:#888;text-align:center;padding:3rem 0;">${lang === 'es' ? 'No hay artículos publicados aún.' : lang === 'en' ? 'No articles published yet.' : 'Nessun articolo pubblicato ancora.'}</p>`
    : ''

  const headerSection = headerHtml ? `<div class="blog-header-custom">${headerHtml}</div>` : ''

  // Build pagination HTML
  let paginationHtml = ''
  if (totalPages > 1) {
    const pageHref = (n: number) => n === 1 ? `${baseUrl}/blog` : `${baseUrl}/blog?page=${n}`
    const prevDisabled = currentPage <= 1
    const nextDisabled = currentPage >= totalPages

    const pageLinks: string[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pageLinks.push(`<a class="blog-page-link${i === currentPage ? ' active' : ''}" href="${pageHref(i)}">${i}</a>`)
      }
    } else {
      // Windowed pagination
      const pages: (number | '...')[] = []
      pages.push(1)
      if (currentPage > 3) pages.push('...')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i)
      }
      if (currentPage < totalPages - 2) pages.push('...')
      pages.push(totalPages)
      for (const p of pages) {
        if (p === '...') {
          pageLinks.push(`<span class="blog-page-link disabled">…</span>`)
        } else {
          pageLinks.push(`<a class="blog-page-link${p === currentPage ? ' active' : ''}" href="${pageHref(p)}">${p}</a>`)
        }
      }
    }

    paginationHtml = `<nav class="blog-pagination" aria-label="Pagination">
  <a class="blog-page-link${prevDisabled ? ' disabled' : ''}" href="${prevDisabled ? '#' : pageHref(currentPage - 1)}" ${prevDisabled ? 'aria-disabled="true"' : ''}>&#8592;</a>
  ${pageLinks.join('\n  ')}
  <a class="blog-page-link${nextDisabled ? ' disabled' : ''}" href="${nextDisabled ? '#' : pageHref(currentPage + 1)}" ${nextDisabled ? 'aria-disabled="true"' : ''}>&#8594;</a>
</nav>`
  }

  const fixedNav = fixNavLinks(siteNav, baseUrl)

  const out = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(baseUrl)}/">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="${escapeHtml(baseUrl)}/blog">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:url" content="${escapeHtml(baseUrl)}/blog">
  <meta property="og:type" content="website">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': ({ es: 'Inicio', it: 'Home', en: 'Home', fr: 'Accueil', de: 'Startseite', pt: 'Início', ca: 'Inici' } as Record<string, string>)[lang] ?? 'Inicio', 'item': `${baseUrl}/` },
      { '@type': 'ListItem', 'position': 2, 'name': 'Blog' },
    ],
  })}</script>
  ${faviconUrl ? `<link rel="icon" href="${safeUrl(faviconUrl)}">` : ''}
  ${injectPoints?.head ?? ''}
  ${siteStyle}
  <style>
    .blog-listing{max-width:1100px;margin:0 auto;padding:3rem 1.5rem 5rem}
    .blog-listing-header{margin-bottom:2.5rem}
    .blog-listing-header h1{font-size:2.4rem;font-weight:800;margin:0 0 .4rem}
    .blog-listing-header p{color:#666;margin:0;font-size:1.05rem}
    .blog-grid{display:grid;gap:1.5rem}
    .blog-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;transition:box-shadow .2s,transform .2s}
    .blog-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.1);transform:translateY(-2px)}
    .blog-card-img{width:100%;height:200px;object-fit:cover;display:block}
    .blog-card-body{padding:1.25rem 1.4rem 1.4rem}
    .blog-card-meta{font-size:.76rem;color:#888;margin-bottom:.6rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .blog-tag{background:#f3f4f6;color:#374151;font-size:.68rem;padding:2px 8px;border-radius:20px;font-weight:600}
    .blog-card-title{font-size:1.15rem;font-weight:700;margin:0 0 .6rem;line-height:1.35}
    .blog-card-title a{color:inherit;text-decoration:none}
    .blog-card-title a:hover{text-decoration:underline}
    .blog-card-excerpt{font-size:.9rem;color:#555;margin:0 0 1rem;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .blog-card-cats{margin-bottom:.5rem}
    .blog-tag-cat{background:#dbeafe;color:#1d4ed8}
    .blog-card-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .blog-read-more{font-size:.85rem;font-weight:600;color:var(--color-accent,#2563eb);text-decoration:none}
    .blog-read-more:hover{text-decoration:underline}
    .blog-card-author{font-size:.75rem;color:#888;font-style:italic}
    @media(min-width:640px){.blog-grid{grid-template-columns:repeat(2,1fr)}}
    @media(min-width:1024px){.blog-grid{grid-template-columns:repeat(3,1fr)}}
    .blog-pagination{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2.5rem;flex-wrap:wrap}
    .blog-page-link{display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;padding:0 10px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:.85rem;font-weight:500;text-decoration:none;transition:background .15s,border-color .15s}
    .blog-page-link:hover{background:#f3f4f6;border-color:#d1d5db}
    .blog-page-link.active{background:var(--color-accent,#2563eb);border-color:var(--color-accent,#2563eb);color:#fff;font-weight:700;pointer-events:none}
    .blog-page-link.disabled{opacity:.4;pointer-events:none}
  </style>
  <style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>
  <style id="nfd-mega-menu-fix">${MEGA_MENU_CSS}</style>
</head>
<body>
  ${fixedNav}
  ${headerSection}
  <section class="blog-listing">
    ${headerHtml ? '' : `<div class="blog-listing-header"><h1>Blog</h1><p>${subtitle}</p></div>`}
    ${emptyState}
    <div class="blog-grid">${cards}</div>
    ${paginationHtml}
  </section>
  ${injectPoints?.blog_list_bottom ? `<div class="blog-inject-wrap" style="max-width:700px;margin:2rem auto;padding:0 1rem">${injectPoints.blog_list_bottom}</div>` : ''}
  ${siteFooter}
  ${injectPoints?.body_end ?? ''}
</body>
</html>`
  return megaPages?.length ? rebuildMegaMenuPanel(out, megaPages) : out
}

export function buildBlogPostPage(
  post: Post,
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'it',
  sidebarBanner?: BlogSidebarBanner | null,
  faviconUrl?: string,
  injectPoints?: InjectPoints,
  dsOverride = '',   // Design System CSS block — injected AFTER blog CSS so DS wins
  megaPages?: MegaPage[],
  relatedPosts?: Post[]
): string {
  const backLabel = '← Blog'
  const dateStr = escapeHtml(formatDate(post.published_at, lang))
  const tags = (post.categories ?? []).map(c => `<span class="blog-tag">${escapeHtml(c)}</span>`).join('')
  const authorLine = post.author ? `<span class="blog-post-author">${escapeHtml(post.author)}</span>` : ''
  // Featured image: eager load (above fold) + fetchpriority high for LCP
  const featuredImg = post.featured_image
    ? `<img class="post-featured-img" src="${safeUrl(post.featured_image)}" alt="${escapeHtml(post.title)}" loading="eager" fetchpriority="high" width="760" height="400" decoding="async">`
    : ''
  const seoTitle = post.seo_title || post.title
  const seoDesc = post.seo_description || post.excerpt || ''
  const canonicalUrl = `${baseUrl}/blog/${post.slug}`

  // Breadcrumb: Home → Blog → current post. JSON-LD for snippets + visible trail
  // above the article header (standard blog UX). Labels follow the site language.
  const homeLabels: Record<string, string> = { es: 'Inicio', it: 'Home', en: 'Home', fr: 'Accueil', de: 'Startseite', pt: 'Início', ca: 'Inici' }
  const homeLabel = homeLabels[lang] ?? 'Inicio'
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': homeLabel, 'item': `${baseUrl}/` },
      { '@type': 'ListItem', 'position': 2, 'name': 'Blog', 'item': `${baseUrl}/blog` },
      { '@type': 'ListItem', 'position': 3, 'name': post.title },
    ],
  }
  // NOTE: deliberately a <div role="navigation">, NOT <nav> — tenant site CSS is injected
  // before the blog CSS and often has aggressive `nav { position:fixed; ... }` selectors
  // that would hijack the breadcrumb (full-width fixed bar over the real header).
  const breadcrumbHtml = `<div class="blog-breadcrumb" role="navigation" aria-label="breadcrumb">
        <a href="${escapeHtml(baseUrl)}/">${escapeHtml(homeLabel)}</a><span class="bc-sep">›</span><a href="${escapeHtml(baseUrl)}/blog">Blog</a><span class="bc-sep">›</span><span aria-current="page">${escapeHtml(post.title)}</span>
      </div>`

  // Schema.org BlogPosting structured data
  const schemaOrg = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    'headline': seoTitle,
    'description': seoDesc || undefined,
    'url': canonicalUrl,
    ...(post.featured_image ? { 'image': post.featured_image } : {}),
    ...(post.published_at ? {
      'datePublished': post.published_at,
      'dateModified': post.published_at,
    } : {}),
    ...(post.author ? { 'author': { '@type': 'Person', 'name': post.author } } : {}),
    ...(post.categories?.length ? { 'keywords': post.categories.join(', ') } : {}),
    'mainEntityOfPage': { '@type': 'WebPage', '@id': canonicalUrl },
  }

  // Extract H2s for TOC and inject IDs
  // Strip H1 tags from content (page header already provides the H1).
  // Any <h1> inside content_html is a duplicate — downgrade to <h2>.
  // Also unwrap <h1> tags that illegally wrap block elements.
  const contentSanitized = post.content_html
    // Downgrade all <h1> → <h2> (preserve any id/class attrs)
    .replace(/<h1(\s[^>]*)?>/gi, (_, attrs) => `<h2${attrs ?? ''}>`)
    .replace(/<\/h1>/gi, '</h2>')

  const { contentWithIds, tocItems } = buildTocFromContent(contentSanitized)

  // Build TOC HTML
  const tocInner = tocItems.length > 0
    ? `<p class="blog-toc-title">${lang === 'es' ? 'Contenido' : lang === 'en' ? 'Contents' : 'Contenuto'}</p>
<ul class="blog-toc-list">
${tocItems.map(item => `  <li><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`).join('\n')}
</ul>`
    : ''

  // Build right sidebar banner HTML
  const bannerHtml = sidebarBanner?.url
    ? `<aside class="blog-sidebar-right" aria-label="Banner">
  <a class="blog-sidebar-banner" href="${safeUrl(sidebarBanner.link || '#')}" target="_blank" rel="noopener">
    <img src="${safeUrl(sidebarBanner.url)}" alt="Banner" loading="lazy">
  </a>
</aside>`
    : `<aside class="blog-sidebar-right"></aside>`

  // Intersection Observer script for active TOC highlighting + smooth scroll
  const tocScript = tocItems.length > 0 ? `<script>
(function(){
  var links=document.querySelectorAll('.blog-toc-list a');
  if(!links.length) return;
  var headings=Array.from(document.querySelectorAll('.blog-post-content h2[id]'));
  function setActive(id){
    links.forEach(function(a){
      a.classList.toggle('toc-active', a.getAttribute('href')==='#'+id);
    });
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting) setActive(e.target.id);
      });
    },{rootMargin:'-10% 0px -75% 0px'});
    headings.forEach(function(h){ io.observe(h); });
  }
  // Smooth scroll
  links.forEach(function(a){
    a.addEventListener('click',function(e){
      e.preventDefault();
      var target=document.querySelector(a.getAttribute('href'));
      if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
})();
</script>` : ''

  const fixedNav = fixNavLinks(siteNav, baseUrl)

  // ── Related posts section (full-width, after the article) ──
  // Cards with image + title; dofollow internal links (anchor = post title) to
  // strengthen internal linking. Up to 6. Hidden if there are none.
  const relatedLabel = lang === 'es' ? 'Artículos relacionados' : lang === 'en' ? 'Related articles' : 'Articoli correlati'
  const relatedCards = (relatedPosts ?? []).slice(0, 3).map(rp => {
    const firstCat = (rp.categories ?? [])[0]
    const catSlug = firstCat ? slugifySimple(firstCat) : null
    const href = catSlug ? `${baseUrl}/blog/${catSlug}/${rp.slug}` : `${baseUrl}/blog/${rp.slug}`
    const img = rp.featured_image
      ? `<img class="related-card-img" src="${safeUrl(rp.featured_image)}" alt="${escapeHtml(rp.title)}" loading="lazy">`
      : `<div class="related-card-img related-card-noimg"></div>`
    const cat = firstCat ? `<span class="related-card-cat">${escapeHtml(firstCat)}</span>` : ''
    return `<a class="related-card" href="${escapeHtml(href)}">
      ${img}
      <div class="related-card-body">${cat}<span class="related-card-title">${escapeHtml(rp.title)}</span></div>
    </a>`
  }).join('\n')
  const relatedHtml = relatedCards ? `<section class="related-posts">
    <style>
      .related-posts{max-width:1100px;margin:3.5rem auto 0;padding:2.5rem 1.5rem 4.5rem;border-top:1px solid #e5e7eb}
      .related-posts h2{font-size:1.5rem;font-weight:800;margin:0 0 1.5rem;color:#111}
      .related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4rem}
      .related-card{display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s}
      .related-card:hover{box-shadow:0 6px 22px rgba(0,0,0,.09);transform:translateY(-2px)}
      .related-card-img{width:100%;height:150px;object-fit:cover;display:block;background:#f3f4f6}
      .related-card-noimg{background:linear-gradient(135deg,#eef2ff,#f8fafc)}
      .related-card-body{padding:.9rem 1rem 1.1rem;display:flex;flex-direction:column;gap:.45rem}
      .related-card-cat{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6366f1}
      .related-card-title{font-size:.98rem;font-weight:700;line-height:1.35;color:#111}
      @media(max-width:900px){.related-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:560px){.related-grid{grid-template-columns:1fr}}
    </style>
    <h2>${relatedLabel}</h2>
    <div class="related-grid">${relatedCards}</div>
  </section>` : ''

  const postOut = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(baseUrl)}/">
  <title>${escapeHtml(seoTitle)}</title>
  <meta name="description" content="${escapeHtml(seoDesc)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${faviconUrl ? `<link rel="icon" href="${safeUrl(faviconUrl)}">` : ''}
  <!-- FCP: preconnect to font origins before any stylesheet loads -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <meta property="og:title" content="${escapeHtml(seoTitle)}">
  <meta property="og:description" content="${escapeHtml(seoDesc)}">
  ${post.featured_image ? `<meta property="og:image" content="${safeUrl(post.featured_image)}">` : ''}
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  ${post.published_at ? `<meta property="article:published_time" content="${escapeHtml(post.published_at)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(schemaOrg)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
  ${injectPoints?.head ?? ''}
  ${siteStyle}
  <style>${BLOG_POST_CONTENT_CSS}</style>
  ${dsOverride}
  <style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>
  <style id="nfd-mega-menu-fix">${MEGA_MENU_CSS}</style>
</head>
<body>
  ${fixedNav}
  <div class="blog-post-layout">
    <!-- TOC sinistra -->
    <aside class="blog-toc" aria-label="Indice">
      <a class="blog-toc-back" href="${escapeHtml(baseUrl)}/blog">${backLabel}</a>
      ${tocInner}
    </aside>

    <!-- Contenuto centrale -->
    <article class="blog-post-wrapper">
      ${breadcrumbHtml}
      <header class="blog-post-header">
        <div class="blog-post-meta">${dateStr}${tags ? ` &nbsp;${tags}` : ''}${authorLine ? ` &nbsp;${authorLine}` : ''}</div>
        <h1>${escapeHtml(post.title)}</h1>
      </header>
      ${featuredImg}
      ${post.excerpt ? `<div class="blog-post-excerpt-box"><p>${escapeHtml(post.excerpt)}</p></div>` : ''}
      <div class="blog-post-content">${contentWithIds}</div>
    </article>
    ${injectPoints?.blog_post_bottom ? `<div class="blog-inject-wrap" style="max-width:700px;margin:3rem auto 0;padding:0 1rem">${injectPoints.blog_post_bottom}</div>` : ''}

    <!-- Banner destra -->
    ${bannerHtml}
  </div>
  ${relatedHtml}
  ${siteFooter}
  ${tocScript}
  ${injectPoints?.body_end ?? ''}
</body>
</html>`
  return megaPages?.length ? rebuildMegaMenuPanel(postOut, megaPages) : postOut
}
