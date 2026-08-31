/**
 * Serve-time rendering for the "Ayuda" (support/help center) section.
 *
 * Reuses the mega-menu/mobile-nav self-heal helpers and small utilities already
 * built for the blog (lib/blog-serve.ts) instead of duplicating them a third time —
 * see the mega-menu-self-heal project memory for why drift between duplicated copies
 * of this logic has already caused real bugs (blog pages missing a nav fix that
 * preview.ts had). Only the parts that are genuinely different from the blog
 * (category tiles, search bar, HowTo schema) live here.
 */
import { FRAME_GLOBAL_FIX } from './shared-frame'
import { injectSocialShareLinks } from './social-share'
import {
  type MegaPage,
  escapeHtml,
  safeUrl,
  formatDate,
  fixNavLinks,
  slugifySimple,
  rebuildAllMegaMenuPanels,
  rebuildMobileMenu,
  ensureMobileNav,
  MEGA_MENU_CSS,
} from './blog-serve'

export type SupportArticle = {
  id: string
  title: string
  slug: string
  excerpt: string
  category: string
  tags: string[]
  published_at: string | null
  content_html: string
  seo_title: string | null
  seo_description: string | null
  author?: string
}

export type SupportCategory = { name: string; count: number }

const SHARED_STYLE = `
  .ayuda-wrap{max-width:1100px;margin:0 auto;padding:3rem 1.5rem 5rem}
  .ayuda-breadcrumb{font-size:.85rem;color:#888;margin-bottom:1.5rem}
  .ayuda-breadcrumb a{color:inherit;text-decoration:none}
  .ayuda-breadcrumb a:hover{text-decoration:underline}
  .ayuda-hero{text-align:center;margin-bottom:2.5rem}
  .ayuda-hero h1{font-size:2.2rem;font-weight:800;margin:0 0 .5rem}
  .ayuda-hero p{color:#666;font-size:1.05rem;margin:0}
  .ayuda-search{max-width:640px;margin:2rem auto 0;position:relative}
  .ayuda-search input{width:100%;box-sizing:border-box;padding:14px 20px 14px 46px;border-radius:999px;border:1px solid #e5e7eb;font-size:1rem;font-family:inherit;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .ayuda-search input:focus{outline:none;border-color:var(--color-accent,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb, var(--color-accent,#2563eb) 20%, transparent)}
  .ayuda-search-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);opacity:.45;pointer-events:none}
  .ayuda-search-results{max-width:640px;margin:.5rem auto 0;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.08);overflow:hidden;display:none}
  .ayuda-search-results.open{display:block}
  .ayuda-search-result{display:block;padding:12px 18px;text-decoration:none;color:inherit;border-bottom:1px solid #f3f4f6}
  .ayuda-search-result:last-child{border-bottom:none}
  .ayuda-search-result:hover{background:#f9fafb}
  .ayuda-search-result-title{font-weight:600;font-size:.92rem;margin-bottom:2px}
  .ayuda-search-result-cat{font-size:.72rem;color:#888}
  .ayuda-search-empty{padding:16px 18px;font-size:.88rem;color:#888}
  .ayuda-cats{display:grid;gap:1.1rem;margin-top:2.5rem}
  @media(min-width:640px){.ayuda-cats{grid-template-columns:repeat(2,1fr)}}
  @media(min-width:900px){.ayuda-cats{grid-template-columns:repeat(3,1fr)}}
  .ayuda-cat-card{display:block;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:1.6rem;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s}
  .ayuda-cat-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.1);transform:translateY(-2px)}
  .ayuda-cat-card h3{margin:.2rem 0 .4rem;font-size:1.05rem;font-weight:700}
  .ayuda-cat-card p{margin:0;font-size:.85rem;color:#888}
  .ayuda-grid{display:grid;gap:1.5rem;margin-top:1.5rem}
  @media(min-width:640px){.ayuda-grid{grid-template-columns:repeat(2,1fr)}}
  @media(min-width:1024px){.ayuda-grid{grid-template-columns:repeat(3,1fr)}}
  .ayuda-card{display:block;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:1.3rem 1.4rem;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s}
  .ayuda-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.1);transform:translateY(-2px)}
  .ayuda-card h2{font-size:1.05rem;font-weight:700;margin:0 0 .5rem;line-height:1.35}
  .ayuda-card p{font-size:.88rem;color:#555;margin:0;line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ayuda-article{max-width:760px;margin:0 auto;padding:3rem 1.5rem 5rem}
  .ayuda-article h1{font-size:1.9rem;font-weight:800;margin:0 0 .8rem;line-height:1.25}
  .ayuda-article-meta{font-size:.82rem;color:#888;margin-bottom:2rem}
  .ayuda-article-content{line-height:1.75;font-size:1.02rem}
  .ayuda-article-content h2{font-size:1.35rem;font-weight:700;margin:2rem 0 .8rem}
  .ayuda-article-content h3{font-size:1.12rem;font-weight:700;margin:1.5rem 0 .6rem}
  .ayuda-article-content img{max-width:100%;border-radius:10px;border:1px solid #e5e7eb}
  .ayuda-related{margin-top:3rem;padding-top:2rem;border-top:1px solid #e5e7eb}
  .ayuda-related h3{font-size:1rem;font-weight:700;margin:0 0 1rem}
  .ayuda-related ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.6rem}
  .ayuda-related a{color:var(--color-accent,#2563eb);text-decoration:none;font-size:.92rem;font-weight:600}
  .ayuda-related a:hover{text-decoration:underline}
`

const LABELS: Record<string, { title: string; subtitle: string; search: string; empty: string; noResults: string; breadcrumbHome: string; breadcrumbAyuda: string }> = {
  es: { title: 'Centro de ayuda', subtitle: '¿En qué podemos ayudarte?', search: 'Busca en los artículos de ayuda…', empty: 'Todavía no hay artículos de ayuda publicados.', noResults: 'No se han encontrado resultados.', breadcrumbHome: 'Inicio', breadcrumbAyuda: 'Ayuda' },
  it: { title: 'Centro assistenza', subtitle: 'Come possiamo aiutarti?', search: 'Cerca negli articoli di supporto…', empty: 'Nessun articolo di supporto pubblicato ancora.', noResults: 'Nessun risultato trovato.', breadcrumbHome: 'Home', breadcrumbAyuda: 'Assistenza' },
  en: { title: 'Help center', subtitle: 'How can we help you?', search: 'Search help articles…', empty: 'No help articles published yet.', noResults: 'No results found.', breadcrumbHome: 'Home', breadcrumbAyuda: 'Help' },
}
function labelsFor(lang: string) { return LABELS[lang] ?? LABELS.es }

const SEARCH_ICON_SVG = `<svg class="ayuda-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

/** Inline search widget: fetches /api/support-articles/search as the user types (debounced). */
function searchWidget(projectId: string, baseUrl: string, lang: string): string {
  const t = labelsFor(lang)
  return `<div class="ayuda-search">
  ${SEARCH_ICON_SVG}
  <input type="search" id="ayuda-search-input" placeholder="${escapeHtml(t.search)}" autocomplete="off">
  <div class="ayuda-search-results" id="ayuda-search-results"></div>
</div>
<script>(function(){
  var input=document.getElementById('ayuda-search-input');
  var results=document.getElementById('ayuda-search-results');
  if(!input||!results) return;
  var t=null, seq=0;
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function render(articles){
    if(!articles.length){results.innerHTML='<div class="ayuda-search-empty">${escapeHtml(t.noResults)}</div>';results.classList.add('open');return;}
    results.innerHTML=articles.map(function(a){
      var cat=a.category?('${baseUrl}/ayuda/'+encodeURIComponent(a.category.toLowerCase())):'${baseUrl}/ayuda';
      var href='${baseUrl}/ayuda/'+encodeURIComponent((a.category||'').toLowerCase())+'/'+encodeURIComponent(a.slug);
      return '<a class="ayuda-search-result" href="'+href+'"><div class="ayuda-search-result-title">'+esc(a.title)+'</div>'+(a.category?'<div class="ayuda-search-result-cat">'+esc(a.category)+'</div>':'')+'</a>';
    }).join('');
    results.classList.add('open');
  }
  input.addEventListener('input',function(){
    clearTimeout(t);
    var q=input.value.trim();
    if(!q){results.classList.remove('open');results.innerHTML='';return;}
    var mySeq=++seq;
    t=setTimeout(function(){
      fetch('/api/support-articles/search?projectId=${encodeURIComponent(projectId)}&q='+encodeURIComponent(q))
        .then(function(r){return r.json();})
        .then(function(json){ if(mySeq===seq) render(json.articles||[]); })
        .catch(function(){});
    },300);
  });
  document.addEventListener('click',function(e){ if(!input.contains(e.target) && !results.contains(e.target)) results.classList.remove('open'); });
})();</script>`
}

/** Derives HowTo schema.org steps from the article's <h2>/<h3> sections. Best-effort — not
 * a strict parser, just gives AI assistants/rich-results a reasonable structured summary. */
function extractHowToSteps(contentHtml: string): { name: string; text: string }[] {
  const steps: { name: string; text: string }[] = []
  const headingRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23][^>]*>|$)/gi
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(contentHtml)) !== null) {
    const name = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
    if (name) steps.push({ name, text })
  }
  return steps.slice(0, 20)
}

export function buildAyudaHubPage(
  projectId: string,
  categories: SupportCategory[],
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'es',
  faviconUrl?: string,
  megaPages?: MegaPage[],
  seoTitle?: string,
  seoDescription?: string
): string {
  const t = labelsFor(lang)
  const title = seoTitle?.trim() || t.title
  const metaDescription = seoDescription?.trim() || t.subtitle
  const canonicalUrl = `${baseUrl}/ayuda`
  const fixedNav = fixNavLinks(siteNav, baseUrl)

  const catCards = categories.map(c => `<a class="ayuda-cat-card" href="${escapeHtml(`${baseUrl}/ayuda/${slugifySimple(c.name)}`)}">
  <h3>${escapeHtml(c.name)}</h3>
  <p>${c.count} ${c.count === 1 ? 'artículo' : 'artículos'}</p>
</a>`).join('\n')

  const emptyState = categories.length === 0
    ? `<p style="color:#888;text-align:center;padding:3rem 0;">${escapeHtml(t.empty)}</p>`
    : ''

  const out = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(baseUrl)}/">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': t.breadcrumbHome, 'item': `${baseUrl}/` },
      { '@type': 'ListItem', 'position': 2, 'name': t.breadcrumbAyuda },
    ],
  })}</script>
  ${faviconUrl ? `<link rel="icon" href="${safeUrl(faviconUrl)}">` : ''}
  ${siteStyle}
  <style>${SHARED_STYLE}</style>
  <style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>
  <style id="nfd-mega-menu-fix">${MEGA_MENU_CSS}</style>
</head>
<body>
  ${fixedNav}
  <div class="ayuda-wrap">
    <div class="ayuda-hero">
      <h1>${escapeHtml(t.title)}</h1>
      <p>${escapeHtml(t.subtitle)}</p>
      ${searchWidget(projectId, baseUrl, lang)}
    </div>
    ${emptyState}
    <div class="ayuda-cats">${catCards}</div>
  </div>
  ${siteFooter}
</body>
</html>`
  const outShared = injectSocialShareLinks(out, canonicalUrl, title)
  const withDesktopNav = rebuildAllMegaMenuPanels(outShared, megaPages)
  const withMobile = megaPages && megaPages.length > 0 ? rebuildMobileMenu(withDesktopNav, megaPages) : withDesktopNav
  return ensureMobileNav(withMobile, megaPages ?? [])
}

export function buildAyudaCategoryPage(
  articles: SupportArticle[],
  category: string,
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'es',
  faviconUrl?: string,
  megaPages?: MegaPage[]
): string {
  const t = labelsFor(lang)
  const title = `${category} — ${t.breadcrumbAyuda}`
  const canonicalUrl = `${baseUrl}/ayuda/${slugifySimple(category)}`
  const fixedNav = fixNavLinks(siteNav, baseUrl)

  const cards = articles.map(a => {
    const href = `${baseUrl}/ayuda/${slugifySimple(category)}/${a.slug}`
    return `<a class="ayuda-card" href="${escapeHtml(href)}">
  <h2>${escapeHtml(a.title)}</h2>
  ${a.excerpt ? `<p>${escapeHtml(a.excerpt)}</p>` : ''}
</a>`
  }).join('\n')

  const emptyState = articles.length === 0
    ? `<p style="color:#888;text-align:center;padding:3rem 0;">${escapeHtml(t.empty)}</p>`
    : ''

  const out = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(baseUrl)}/">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(category)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': t.breadcrumbHome, 'item': `${baseUrl}/` },
      { '@type': 'ListItem', 'position': 2, 'name': t.breadcrumbAyuda, 'item': `${baseUrl}/ayuda` },
      { '@type': 'ListItem', 'position': 3, 'name': category },
    ],
  })}</script>
  ${faviconUrl ? `<link rel="icon" href="${safeUrl(faviconUrl)}">` : ''}
  ${siteStyle}
  <style>${SHARED_STYLE}</style>
  <style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>
  <style id="nfd-mega-menu-fix">${MEGA_MENU_CSS}</style>
</head>
<body>
  ${fixedNav}
  <div class="ayuda-wrap">
    <div class="ayuda-breadcrumb"><a href="${escapeHtml(`${baseUrl}/ayuda`)}">${escapeHtml(t.breadcrumbAyuda)}</a> / ${escapeHtml(category)}</div>
    <div class="ayuda-hero"><h1>${escapeHtml(category)}</h1></div>
    ${emptyState}
    <div class="ayuda-grid">${cards}</div>
  </div>
  ${siteFooter}
</body>
</html>`
  const outShared = injectSocialShareLinks(out, canonicalUrl, title)
  const withDesktopNav = rebuildAllMegaMenuPanels(outShared, megaPages)
  const withMobile = megaPages && megaPages.length > 0 ? rebuildMobileMenu(withDesktopNav, megaPages) : withDesktopNav
  return ensureMobileNav(withMobile, megaPages ?? [])
}

export function buildAyudaArticlePage(
  article: SupportArticle,
  relatedArticles: SupportArticle[],
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'es',
  faviconUrl?: string,
  megaPages?: MegaPage[]
): string {
  const t = labelsFor(lang)
  const title = article.seo_title?.trim() || article.title
  const metaDescription = article.seo_description?.trim() || article.excerpt || article.title
  const catSlug = slugifySimple(article.category || '')
  const canonicalUrl = catSlug ? `${baseUrl}/ayuda/${catSlug}/${article.slug}` : `${baseUrl}/ayuda/${article.slug}`
  const fixedNav = fixNavLinks(siteNav, baseUrl)
  const dateStr = escapeHtml(formatDate(article.published_at, lang))

  const steps = extractHowToSteps(article.content_html)
  const howToSchema = steps.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    'name': article.title,
    'description': metaDescription,
    'step': steps.map(s => ({ '@type': 'HowToStep', 'name': s.name, 'text': s.text })),
  } : null

  const relatedHtml = relatedArticles.length > 0 ? `<div class="ayuda-related">
  <h3>${lang === 'es' ? 'Artículos relacionados' : lang === 'en' ? 'Related articles' : 'Articoli correlati'}</h3>
  <ul>${relatedArticles.map(r => {
    const rCat = slugifySimple(r.category || '')
    const rHref = rCat ? `${baseUrl}/ayuda/${rCat}/${r.slug}` : `${baseUrl}/ayuda/${r.slug}`
    return `<li><a href="${escapeHtml(rHref)}">${escapeHtml(r.title)}</a></li>`
  }).join('')}</ul>
</div>` : ''

  const out = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeHtml(baseUrl)}/">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': t.breadcrumbHome, 'item': `${baseUrl}/` },
      { '@type': 'ListItem', 'position': 2, 'name': t.breadcrumbAyuda, 'item': `${baseUrl}/ayuda` },
      ...(article.category ? [{ '@type': 'ListItem', 'position': 3, 'name': article.category, 'item': `${baseUrl}/ayuda/${catSlug}` }] : []),
      { '@type': 'ListItem', 'position': article.category ? 4 : 3, 'name': article.title },
    ],
  })}</script>
  ${howToSchema ? `<script type="application/ld+json">${JSON.stringify(howToSchema)}</script>` : ''}
  ${faviconUrl ? `<link rel="icon" href="${safeUrl(faviconUrl)}">` : ''}
  ${siteStyle}
  <style>${SHARED_STYLE}</style>
  <style id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>
  <style id="nfd-mega-menu-fix">${MEGA_MENU_CSS}</style>
</head>
<body>
  ${fixedNav}
  <article class="ayuda-article">
    <div class="ayuda-breadcrumb"><a href="${escapeHtml(`${baseUrl}/ayuda`)}">${escapeHtml(t.breadcrumbAyuda)}</a>${article.category ? ` / <a href="${escapeHtml(`${baseUrl}/ayuda/${catSlug}`)}">${escapeHtml(article.category)}</a>` : ''}</div>
    <h1>${escapeHtml(article.title)}</h1>
    <div class="ayuda-article-meta">${dateStr}${article.author ? ` · ${escapeHtml(article.author)}` : ''}</div>
    <div class="ayuda-article-content">${article.content_html}</div>
    ${relatedHtml}
  </article>
  ${siteFooter}
</body>
</html>`
  const outShared = injectSocialShareLinks(out, canonicalUrl, title)
  const withDesktopNav = rebuildAllMegaMenuPanels(outShared, megaPages)
  const withMobile = megaPages && megaPages.length > 0 ? rebuildMobileMenu(withDesktopNav, megaPages) : withDesktopNav
  return ensureMobileNav(withMobile, megaPages ?? [])
}
