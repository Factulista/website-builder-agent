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

export function buildBlogListPage(
  posts: Post[],
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'it'
): string {
  const title = 'Blog'
  const subtitle = lang === 'es' ? 'Artículos y novedades' : lang === 'en' ? 'Articles and updates' : 'Articoli e aggiornamenti'
  const readMoreLabel = lang === 'es' ? 'Leer más →' : lang === 'en' ? 'Read more →' : 'Leggi →'

  const cards = posts.map(post => {
    const img = post.featured_image
      ? `<img class="blog-card-img" src="${post.featured_image}" alt="${post.title}" loading="lazy">`
      : ''
    const firstCat = (post.categories ?? [])[0]
    const catSlug = firstCat ? slugifySimple(firstCat) : null
    const postHref = catSlug ? `${baseUrl}/blog/${catSlug}/${post.slug}` : `${baseUrl}/blog/${post.slug}`
    const catTag = firstCat ? `<span class="blog-tag blog-tag-cat">${firstCat}</span>` : ''
    const dateStr = formatDate(post.published_at, lang)
    const authorStr = post.author ? `<span class="blog-card-author">${post.author}</span>` : ''
    return `<article class="blog-card">
  ${img}
  <div class="blog-card-body">
    ${catTag ? `<div class="blog-card-cats">${catTag}</div>` : ''}
    <div class="blog-card-meta">${dateStr}</div>
    <h2 class="blog-card-title"><a href="${postHref}">${post.title}</a></h2>
    ${post.excerpt ? `<p class="blog-card-excerpt">${post.excerpt}</p>` : ''}
    <div class="blog-card-footer">
      <a class="blog-read-more" href="${postHref}">${readMoreLabel}</a>
      ${authorStr}
    </div>
  </div>
</article>`
  }).join('\n')

  const emptyState = posts.length === 0
    ? `<p style="color:#888;text-align:center;padding:3rem 0;">${lang === 'es' ? 'No hay artículos publicados aún.' : lang === 'en' ? 'No articles published yet.' : 'Nessun articolo pubblicato ancora.'}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${subtitle}">
  <link rel="canonical" href="${baseUrl}/blog">
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
  </style>
</head>
<body>
  ${siteNav}
  <section class="blog-listing">
    <div class="blog-listing-header"><h1>${title}</h1><p>${subtitle}</p></div>
    ${emptyState}
    <div class="blog-grid">${cards}</div>
  </section>
  ${siteFooter}
</body>
</html>`
}

export function buildBlogPostPage(
  post: Post,
  baseUrl: string,
  siteNav: string,
  siteFooter: string,
  siteStyle: string,
  lang = 'it'
): string {
  const backLabel = '← Blog'
  const dateStr = formatDate(post.published_at, lang)
  const tags = (post.categories ?? []).map(c => `<span class="blog-tag">${c}</span>`).join('')
  const authorLine = post.author ? `<span class="blog-post-author">${post.author}</span>` : ''
  const featuredImg = post.featured_image
    ? `<img class="post-featured-img" src="${post.featured_image}" alt="${post.title}" loading="lazy">`
    : ''
  const seoTitle = post.seo_title || post.title
  const seoDesc = post.seo_description || post.excerpt || ''

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${seoTitle}</title>
  <meta name="description" content="${seoDesc}">
  <link rel="canonical" href="${baseUrl}/blog/${post.slug}">
  <meta property="og:title" content="${seoTitle}">
  <meta property="og:description" content="${seoDesc}">
  ${post.featured_image ? `<meta property="og:image" content="${post.featured_image}">` : ''}
  <meta property="og:url" content="${baseUrl}/blog/${post.slug}">
  <meta property="og:type" content="article">
  ${post.published_at ? `<meta property="article:published_time" content="${post.published_at}">` : ''}
  ${siteStyle}
  <style>
    .blog-post-wrapper{max-width:760px;margin:0 auto;padding:2.5rem 1.5rem 5rem}
    .blog-back-link{display:inline-block;font-size:.85rem;font-weight:600;color:var(--color-accent,#2563eb);text-decoration:none;margin-bottom:1.5rem}
    .blog-back-link:hover{text-decoration:underline}
    .blog-post-header{margin-bottom:2rem}
    .blog-post-meta{font-size:.78rem;color:#888;margin-bottom:.7rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .blog-tag{background:#f3f4f6;color:#374151;font-size:.68rem;padding:2px 8px;border-radius:20px;font-weight:600}
    .blog-post-header h1{font-size:2.2rem;font-weight:800;line-height:1.25;margin:0 0 .75rem}
    .blog-post-excerpt{font-size:1.05rem;color:#555;line-height:1.6;margin:0}
    .post-featured-img{width:100%;border-radius:12px;margin:1.5rem 0 2rem;max-height:420px;object-fit:cover}
    .blog-post-content{font-size:1rem;line-height:1.8;color:#1a1a1a}
    .blog-post-content h2{font-size:1.5rem;font-weight:700;margin:2.5rem 0 .75rem}
    .blog-post-content h3{font-size:1.2rem;font-weight:600;margin:2rem 0 .6rem}
    .blog-post-content p{margin:0 0 1.25rem}
    .blog-post-content ul,.blog-post-content ol{margin:0 0 1.25rem;padding-left:1.5rem}
    .blog-post-content li{margin-bottom:.4rem}
    .blog-post-content img{max-width:100%;height:auto;border-radius:8px;margin:1.5rem 0}
    .blog-post-content a{color:var(--color-accent,#2563eb)}
    .blog-post-content blockquote{border-left:4px solid var(--color-accent,#2563eb);margin:1.5rem 0;padding:.75rem 1.25rem;background:#f8f9ff;border-radius:0 8px 8px 0;font-style:italic;color:#444}
    .blog-post-content pre{background:#1a1a1a;color:#f8f8f8;border-radius:10px;padding:1.25rem;overflow-x:auto;font-size:.88rem;margin:1.5rem 0}
    .blog-post-content code{font-family:'Fira Code',monospace;font-size:.88em;background:#f3f4f6;padding:2px 5px;border-radius:4px}
    .blog-post-content pre code{background:none;padding:0}
    .blog-post-author{font-size:.75rem;color:#666;font-style:italic}
    @media(max-width:640px){.blog-post-header h1{font-size:1.7rem}.blog-post-wrapper{padding:1.5rem 1rem 3rem}}
  </style>
</head>
<body>
  ${siteNav}
  <article class="blog-post-wrapper">
    <a class="blog-back-link" href="${baseUrl}/blog">${backLabel}</a>
    <header class="blog-post-header">
      <div class="blog-post-meta">${dateStr}${tags ? ` &nbsp;${tags}` : ''}${authorLine ? ` &nbsp;${authorLine}` : ''}</div>
      <h1>${post.title}</h1>
      ${post.excerpt ? `<p class="blog-post-excerpt">${post.excerpt}</p>` : ''}
    </header>
    ${featuredImg}
    <div class="blog-post-content">${post.content_html}</div>
  </article>
  ${siteFooter}
</body>
</html>`
}
