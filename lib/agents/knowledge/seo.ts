export const SEO_KNOWLEDGE = `
## KNOWLEDGE BASE SEO

### Meta Tag Essenziali
- <title>: 50-60 caratteri, keyword principale all'inizio, brand alla fine (es: "Ristorante Milano | Cucina Toscana")
- <meta name="description">: 150-160 caratteri, include keyword + CTA implicita
- <link rel="canonical">: sempre presente, URL assoluto
- <meta name="robots">: default "index, follow"

### Open Graph (OG)
- og:title, og:description, og:url, og:image (1200x630px), og:type, og:locale="it_IT"
- Twitter: twitter:card="summary_large_image", twitter:title, twitter:description

### Schema.org Comuni
- LocalBusiness → Restaurant, LegalService, MedicalBusiness, RealEstateAgent
- Organization, Person, Product, Service, FAQPage, BreadcrumbList
- Sempre includere: name, url, description, address (se locale), telephone

### Heading Hierarchy
- Un solo H1 per pagina, contiene keyword principale
- H2 per sezioni principali, H3 per sottosezioni
- Non saltare livelli (H1 → H3 è sbagliato)

### Core Web Vitals
- LCP: immagine hero con loading="eager" (non lazy), preload se critica
- CLS: width e height espliciti su tutte le immagini
- FID: minimizza JavaScript inline

### Sitemap XML
- Include tutte le pagine pubbliche
- <lastmod> in formato YYYY-MM-DD
- <changefreq>: monthly per pagine statiche, weekly per blog
- <priority>: 1.0 homepage, 0.8 pagine principali, 0.5 blog/secondarie
`
