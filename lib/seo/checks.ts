// ── SEO Check Definitions ──────────────────────────────────────────────────────
// The single source of truth for all 15 SEO checks.
// analyzer.ts uses these to run client-side analysis.
// prompt-builder.ts uses these to build targeted fix prompts.

export type CheckId =
  | 'title'
  | 'meta-description'
  | 'canonical'
  | 'lang'
  | 'open-graph'
  | 'h1-unique'
  | 'h1-keyword'
  | 'heading-hierarchy'
  | 'semantic-html'
  | 'alt-text'
  | 'img-dimensions'
  | 'lazy-loading'
  | 'font-preconnect'
  | 'schema-organization'
  | 'schema-faq'

export type CheckGroup = 'meta' | 'structure' | 'images' | 'performance' | 'schema'
export type FixOwner = 'html' | 'seo'

export type SeoCheck = {
  id: CheckId
  label: string
  description: string
  group: CheckGroup
  groupLabel: string
  fixOwner: FixOwner
  /** binary = pass/fail only (0 or 100); scored = 0–100 gradient */
  scoreType: 'binary' | 'scored'
  /** Weight for weighted overall score (sum = 100) */
  weight: number
}

export const SEO_CHECKS: SeoCheck[] = [
  // ── Meta & Title (35 pts total) ──────────────────────────────────────────────
  {
    id: 'title',
    label: 'Title tag ottimizzato',
    description: 'Presente, 50–60 caratteri, contiene la keyword primaria della pagina.',
    group: 'meta',
    groupLabel: '📋 Meta & Title',
    fixOwner: 'seo',
    scoreType: 'scored',
    weight: 15,
  },
  {
    id: 'meta-description',
    label: 'Meta description ottimizzata',
    description: '150–160 caratteri, include un CTA. Impatta direttamente il CTR in SERP.',
    group: 'meta',
    groupLabel: '📋 Meta & Title',
    fixOwner: 'seo',
    scoreType: 'scored',
    weight: 12,
  },
  {
    id: 'canonical',
    label: 'Canonical URL',
    description: '<link rel="canonical"> evita contenuti duplicati e consolida il ranking.',
    group: 'meta',
    groupLabel: '📋 Meta & Title',
    fixOwner: 'html',
    scoreType: 'binary',
    weight: 5,
  },
  {
    id: 'lang',
    label: 'Attributo lang su <html>',
    description: 'lang="xx" aiuta Google con il targeting geografico e linguistico.',
    group: 'meta',
    groupLabel: '📋 Meta & Title',
    fixOwner: 'html',
    scoreType: 'binary',
    weight: 3,
  },
  // ── Structure (29 pts total) ──────────────────────────────────────────────────
  {
    id: 'open-graph',
    label: 'Open Graph completo',
    description: 'og:title, og:description, og:image e og:url migliorano il CTR sui social.',
    group: 'structure',
    groupLabel: '🏗️ Struttura',
    fixOwner: 'seo',
    scoreType: 'scored',
    weight: 8,
  },
  {
    id: 'h1-unique',
    label: 'H1 unico per pagina',
    description: 'Ogni pagina deve avere esattamente 1 H1 — il segnale heading più importante per Google.',
    group: 'structure',
    groupLabel: '🏗️ Struttura',
    fixOwner: 'html',
    scoreType: 'binary',
    weight: 9,
  },
  {
    id: 'h1-keyword',
    label: 'H1 con keyword significativa',
    description: "L'H1 deve contenere la keyword primaria della pagina in modo naturale.",
    group: 'structure',
    groupLabel: '🏗️ Struttura',
    fixOwner: 'seo',
    scoreType: 'scored',
    weight: 7,
  },
  {
    id: 'heading-hierarchy',
    label: 'Gerarchia heading H1→H2→H3',
    description: 'Gli heading devono scendere di livello senza salti (es: H1→H3 è sbagliato).',
    group: 'structure',
    groupLabel: '🏗️ Struttura',
    fixOwner: 'html',
    scoreType: 'scored',
    weight: 5,
  },
  // ── Images (18 pts total) ─────────────────────────────────────────────────────
  {
    id: 'semantic-html',
    label: 'Tag semantici HTML5',
    description: '<header>, <nav>, <main>, <footer>, <article> rendono la struttura leggibile dai crawler.',
    group: 'images',
    groupLabel: '🖼️ Immagini & HTML',
    fixOwner: 'html',
    scoreType: 'scored',
    weight: 5,
  },
  {
    id: 'alt-text',
    label: 'Alt text su tutte le immagini',
    description: 'Ogni <img> deve avere un alt descrittivo. Impatta Google Images e accessibilità.',
    group: 'images',
    groupLabel: '🖼️ Immagini & HTML',
    fixOwner: 'seo',
    scoreType: 'scored',
    weight: 8,
  },
  {
    id: 'img-dimensions',
    label: 'Width e height su immagini',
    description: 'Prevengono il Cumulative Layout Shift (CLS) — metrica Core Web Vitals.',
    group: 'images',
    groupLabel: '🖼️ Immagini & HTML',
    fixOwner: 'html',
    scoreType: 'scored',
    weight: 5,
  },
  // ── Performance (8 pts total) ─────────────────────────────────────────────────
  {
    id: 'lazy-loading',
    label: 'Lazy loading immagini',
    description: 'loading="lazy" sulle img non above-the-fold migliora LCP e velocità percepita.',
    group: 'performance',
    groupLabel: '⚡ Performance',
    fixOwner: 'html',
    scoreType: 'scored',
    weight: 3,
  },
  {
    id: 'font-preconnect',
    label: 'Preconnect Google Fonts',
    description: '<link rel="preconnect"> riduce il tempo di caricamento dei font di ~150–200ms.',
    group: 'performance',
    groupLabel: '⚡ Performance',
    fixOwner: 'html',
    scoreType: 'binary',
    weight: 5,
  },
  // ── Schema.org (10 pts total) ─────────────────────────────────────────────────
  {
    id: 'schema-organization',
    label: 'Schema.org Organization',
    description: 'JSON-LD Organization/LocalBusiness aiuta Google a capire l\'entità del sito.',
    group: 'schema',
    groupLabel: '📊 Schema.org',
    fixOwner: 'seo',
    scoreType: 'binary',
    weight: 7,
  },
  {
    id: 'schema-faq',
    label: 'Schema.org FAQ',
    description: 'Se la pagina ha una FAQ, il markup strutturato genera rich snippets in SERP.',
    group: 'schema',
    groupLabel: '📊 Schema.org',
    fixOwner: 'seo',
    scoreType: 'binary',
    weight: 3,
  },
]

export const SEO_GROUPS: { id: CheckGroup; label: string }[] = [
  { id: 'meta', label: '📋 Meta & Title' },
  { id: 'structure', label: '🏗️ Struttura' },
  { id: 'images', label: '🖼️ Immagini & HTML' },
  { id: 'performance', label: '⚡ Performance' },
  { id: 'schema', label: '📊 Schema.org' },
]

export function getCheck(id: CheckId): SeoCheck {
  const c = SEO_CHECKS.find(c => c.id === id)
  if (!c) throw new Error(`Unknown check id: ${id}`)
  return c
}
