/**
 * Project-Specific Rules — Extracted from site_config and learned from the project.
 *
 * The system automatically learns these rules from:
 * - HTML patterns in existing pages
 * - Project context (language, business type)
 * - User requests and corrections
 * - Quality checks that identify patterns
 *
 * Rules are stored in site_config.projectRules and passed to all agents.
 */

export type ProjectRules = {
  // ── Links ──────────────────────────────────────────────
  links: {
    /** Use relative links like "./slug" instead of "/slug" or "slug" */
    relative: boolean
    /** Domain name for canonical/og:url (if custom domain) */
    domain?: string
  }

  // ── Forms ──────────────────────────────────────────────
  forms: {
    /** Forms send to this endpoint (e.g., "/api/forms") */
    endpoint: string
    /** Form field names (e.g., ["nombre", "email", "mensaje"]) */
    fields: string[]
  }

  // ── CSS & Styling ──────────────────────────────────────
  styling: {
    /** Allow Tailwind classes (false = use CSS custom only) */
    useTailwind: boolean
    /** Prefix for CSS variables (e.g., "--" or "--tw-") */
    cssVarPrefix: string
    /** Allow inline style="" attributes */
    allowInlineStyles: boolean
    /** Mobile menu toggle class (e.g., "open", "active", "is-open") */
    mobileMenuToggleClass: string
  }

  // ── HTML & Semantics ──────────────────────────────────
  html: {
    /** Exactly 1 H1 per page (if true, quality check enforces it) */
    singleH1: boolean
    /** Allow deprecated tags like <font>, <center>, <strike> */
    allowDeprecated: boolean
    /** Require alt text on all images */
    requireImageAlt: boolean
    /** Require width/height on images */
    requireImageDimensions: boolean
  }

  // ── Images ─────────────────────────────────────────────
  images: {
    /** Image storage location: "supabase" | "external-url" | "mixed" */
    storage: 'supabase' | 'external-url' | 'mixed'
    /** Require both alt and title on images */
    requireMetadata: boolean
  }

  // ── Blog & Pages ───────────────────────────────────────
  content: {
    /** Blog posts stored separately (not in site_config.pages) */
    blogSeparate: boolean
    /** Never auto-create blog pages from site builder */
    noBlogAutoCreate: boolean
    /** Blog slug pattern (e.g., "/blog/{slug}") */
    blogSlugPattern?: string
  }

  // ── Context & Language ─────────────────────────────────
  context: {
    /** Site language (e.g., "it", "es", "en") */
    language: string
    /** Business type (e.g., "ristorante", "studio", "e-commerce") */
    businessType?: string
    /** Business name */
    businessName?: string
  }

  // ── Meta & SEO ─────────────────────────────────────────
  seo: {
    /** Require schema.org JSON-LD on pages */
    requireSchema: boolean
    /** Require meta description on all pages */
    requireMetaDescription: boolean
    /** Canonical URL strategy: "custom-domain" | "relative" | "none" */
    canonicalStrategy: 'custom-domain' | 'relative' | 'none'
  }

  // ── Metadata ───────────────────────────────────────────
  _learned: {
    /** When these rules were auto-detected from the project */
    detectedAt?: string
    /** Which agent/process learned each rule */
    learnedFrom?: Record<string, string>
    /** Confidence level for auto-learned rules (0-100) */
    confidence?: Record<string, number>
  }
}

/** Default rules for Factulista projects */
export const DEFAULT_FACTULISTA_RULES: ProjectRules = {
  links: {
    relative: true,
  },
  forms: {
    endpoint: '/api/forms',
    fields: ['nombre', 'email', 'tipo', 'empresa', 'mensaje'],
  },
  styling: {
    useTailwind: false,
    cssVarPrefix: '--',
    allowInlineStyles: false,
    mobileMenuToggleClass: 'open',
  },
  html: {
    singleH1: true,
    allowDeprecated: false,
    requireImageAlt: true,
    requireImageDimensions: true,
  },
  images: {
    storage: 'supabase',
    requireMetadata: true,
  },
  content: {
    blogSeparate: true,
    noBlogAutoCreate: true,
    blogSlugPattern: '/blog/{slug}',
  },
  context: {
    language: 'it',
  },
  seo: {
    requireSchema: true,
    requireMetaDescription: true,
    canonicalStrategy: 'custom-domain',
  },
  _learned: {},
}

/**
 * Extract rules from existing project pages.
 * Auto-detects: link style, form endpoints, CSS approach, image patterns.
 */
export function learnRulesFromPages(
  pages: Array<{ slug: string; html: string; name: string }>
): Partial<ProjectRules> {
  const learned: any = {
    _learned: { detectedAt: new Date().toISOString(), learnedFrom: {}, confidence: {} },
  }

  if (pages.length === 0) return learned

  const allHtml = pages.map(p => p.html).join('\n')

  // ── Links ──────────────────────────────────────────────
  const relativeLinks = (allHtml.match(/href="\.\//g) ?? []).length
  const absoluteLinks = (allHtml.match(/href="\/[^./]/g) ?? []).length
  const bareLinks = (allHtml.match(/href="[a-z-]+"/g) ?? []).length

  if (relativeLinks > absoluteLinks && relativeLinks > bareLinks) {
    learned.links = { relative: true }
    learned._learned.learnedFrom['links'] = 'detected_from_existing_pages'
    learned._learned.confidence['links'] = Math.min(100, Math.round((relativeLinks / (relativeLinks + absoluteLinks + bareLinks)) * 100))
  }

  // ── Forms ──────────────────────────────────────────────
  const formMatches = (allHtml.match(/action=["']([^"']+)["']/gi) ?? []) as string[]
  const formEndpointMatch = formMatches.length > 0 ? formMatches[0].match(/action=["']([^"']+)["']/i) : null
  const formEndpoint = (formEndpointMatch?.[1] as string | undefined) ?? null

  if (formEndpoint) {
    const fieldMatches = allHtml.match(/name=["']([^"']+)["']/gi) ?? []
    const fields = [...new Set(fieldMatches.map(m => m.match(/name=["']([^"']+)["']/i)?.[1]).filter((f): f is string => f !== undefined))]

    learned.forms = { endpoint: formEndpoint, fields }
    learned._learned.learnedFrom['forms'] = 'extracted_from_form_tags'
    learned._learned.confidence['forms'] = 95
  }

  // ── CSS & Styling ──────────────────────────────────────
  const tailwindClasses = (allHtml.match(/class="[^"]*\b(?:text-|font-|px-|py-|w-|h-|flex|grid)[^\s"]*\b/g) ?? []).length
  const cssVars = (allHtml.match(/var\(--[a-z-]+\)/gi) ?? []).length
  const inlineStyles = (allHtml.match(/style="/gi) ?? []).length
  const mobileMenuClass = allHtml.includes('open') ? 'open' : allHtml.includes('is-open') ? 'is-open' : allHtml.includes('active') ? 'active' : null

  if (tailwindClasses === 0 && cssVars > 0) {
    learned.styling = {
      useTailwind: false,
      cssVarPrefix: '--',
      allowInlineStyles: inlineStyles === 0,
      mobileMenuToggleClass: mobileMenuClass ?? 'open',
    }
    learned._learned.learnedFrom['styling'] = 'inferred_from_css_patterns'
    learned._learned.confidence['styling'] = 85
  }

  // ── HTML & Semantics ──────────────────────────────────
  const h1Counts = pages.map(p => (p.html.match(/<h1/gi) ?? []).length)
  const allH1sExactlyOne = h1Counts.every(c => c === 1)

  if (allH1sExactlyOne && pages.length > 1) {
    learned.html = { singleH1: true, allowDeprecated: false, requireImageAlt: true, requireImageDimensions: true }
    learned._learned.learnedFrom['html'] = 'observed_in_all_pages'
    learned._learned.confidence['html'] = 100
  }

  // ── Images ─────────────────────────────────────────────
  const imgTags = allHtml.match(/<img[^>]*>/gi) ?? []
  const imgWithAlt = imgTags.filter(tag => /\balt=/i.test(tag)).length
  const imgWithDimensions = imgTags.filter(tag => /\b(?:width|height)=/i.test(tag)).length

  if (imgTags.length > 0) {
    learned.images = {
      storage: allHtml.includes('supabase') ? 'supabase' : 'external-url',
      requireMetadata: imgWithAlt === imgTags.length && imgWithDimensions === imgTags.length,
    }
    learned._learned.learnedFrom['images'] = 'analyzed_image_patterns'
    learned._learned.confidence['images'] = Math.round((imgWithAlt / imgTags.length) * 100)
  }

  // ── Blog ───────────────────────────────────────────────
  const blogPageExists = pages.some(p => p.slug === 'blog' || p.slug.startsWith('blog-'))
  if (!blogPageExists) {
    learned.content = { blogSeparate: true, noBlogAutoCreate: true }
    learned._learned.learnedFrom['content'] = 'no_blog_pages_in_site_config'
    learned._learned.confidence['content'] = 100
  }

  return learned
}

/**
 * Merge learned rules with defaults, preferring learned rules.
 * Keeps track of confidence levels for back office display.
 */
export function mergeRules(
  defaults: ProjectRules,
  learned: Partial<ProjectRules>
): ProjectRules {
  return {
    links: learned.links ?? defaults.links,
    forms: learned.forms ?? defaults.forms,
    styling: learned.styling ?? defaults.styling,
    html: learned.html ?? defaults.html,
    images: learned.images ?? defaults.images,
    content: learned.content ?? defaults.content,
    context: { ...defaults.context, ...learned.context },
    seo: learned.seo ?? defaults.seo,
    _learned: learned._learned ?? defaults._learned,
  }
}

/**
 * Format rules as a markdown string for agents (brief reference).
 */
export function formatRulesForAgent(rules: ProjectRules, language: string = 'it'): string {
  const lines = [
    '## REGOLE SPECIFICHE DI PROGETTO',
    '',
    '### Link e Navigate',
    `- Usa link relativi: href="./slug" (non "/slug" o "slug")`,
    `- Dominio: ${rules.links.domain ?? '(dynamic)'}`,
    '',
    '### Form',
    `- Endpoint: ${rules.forms.endpoint}`,
    `- Campi: ${rules.forms.fields.join(', ')}`,
    '',
    '### CSS e Stile',
    `- Tailwind: ${rules.styling.useTailwind ? 'ABILITATO' : 'VIETATO'}`,
    `- Prefisso CSS var: ${rules.styling.cssVarPrefix}`,
    `- Inline style: ${rules.styling.allowInlineStyles ? 'consentito' : 'VIETATO'}`,
    `- Mobile menu toggle: class="${rules.styling.mobileMenuToggleClass}"`,
    '',
    '### HTML e Semantica',
    `- H1 per pagina: esattamente ${rules.html.singleH1 ? '1' : 'any'}`,
    `- Tag deprecati: ${rules.html.allowDeprecated ? 'consentiti' : 'VIETATI'}`,
    `- Alt sulle immagini: ${rules.html.requireImageAlt ? 'OBBLIGATORIO' : 'opzionale'}`,
    `- Width/height immagini: ${rules.html.requireImageDimensions ? 'OBBLIGATORIO' : 'opzionale'}`,
    '',
    '### Immagini',
    `- Storage: ${rules.images.storage}`,
    `- Metadata (alt + title): ${rules.images.requireMetadata ? 'OBBLIGATORIO' : 'opzionale'}`,
    '',
    '### Blog e Contenuti',
    `- Blog separato: ${rules.content.blogSeparate ? 'SÌ' : 'NO'}`,
    `- Auto-create blog: ${rules.content.noBlogAutoCreate ? 'DISABILITATO' : 'abilitato'}`,
    rules.content.blogSlugPattern ? `- Pattern blog: ${rules.content.blogSlugPattern}` : '',
    '',
    '### Contesto',
    `- Lingua: ${rules.context.language}`,
    rules.context.businessType ? `- Business: ${rules.context.businessType}` : '',
    rules.context.businessName ? `- Nome: ${rules.context.businessName}` : '',
  ]

  return lines.filter(Boolean).join('\n')
}

/**
 * Check if HTML violates project rules (for quality checker integration).
 */
export function checkRuleViolations(
  html: string,
  rules: ProjectRules
): { violations: string[]; warnings: string[] } {
  const violations: string[] = []
  const warnings: string[] = []

  // Link rules
  if (rules.links.relative) {
    const absoluteLinks = (html.match(/href="\/[^./]/g) ?? []).length
    if (absoluteLinks > 0) {
      violations.push(`${absoluteLinks} link assoluti trovati — regola progetto: usa href="./slug"`)
    }
  }

  // Form rules
  const formMatches = html.match(/<form[^>]*>/gi) ?? []
  if (formMatches.length > 0) {
    for (const form of formMatches) {
      if (!form.includes(rules.forms.endpoint)) {
        violations.push(`Form senza endpoint "${rules.forms.endpoint}" — regola progetto`)
      }
    }
  }

  // CSS rules
  if (!rules.styling.useTailwind) {
    const tailwindClasses = (html.match(/class="[^"]*\b(?:text-|font-|px-|py-|w-|h-)[^\s"]*\b/g) ?? []).length
    if (tailwindClasses > 0) {
      violations.push(`${tailwindClasses} classi Tailwind rilevate — regola progetto: usa CSS custom`)
    }
  }

  if (!rules.styling.allowInlineStyles) {
    const inlineStyles = (html.match(/style="/gi) ?? []).length
    if (inlineStyles > 0) {
      warnings.push(`${inlineStyles} attributi style="" — regola progetto preferisce classi CSS`)
    }
  }

  // Mobile menu
  if (rules.styling.mobileMenuToggleClass) {
    if (html.includes('class="active"') && rules.styling.mobileMenuToggleClass !== 'active') {
      warnings.push(`Menu mobile usa class="active" — regola progetto: usa class="${rules.styling.mobileMenuToggleClass}"`)
    }
  }

  // HTML rules
  if (rules.html.singleH1) {
    const h1Count = (html.match(/<h1/gi) ?? []).length
    if (h1Count !== 1) {
      violations.push(`${h1Count} tag H1 — regola progetto: esattamente 1`)
    }
  }

  if (rules.html.requireImageAlt) {
    const imgTags = html.match(/<img[^>]*>/gi) ?? []
    const missing = imgTags.filter(tag => !/\balt=/i.test(tag)).length
    if (missing > 0) {
      violations.push(`${missing} immagini senza alt="" — regola progetto: obbligatorio`)
    }
  }

  if (rules.html.requireImageDimensions) {
    const imgTags = html.match(/<img[^>]*>/gi) ?? []
    const missing = imgTags.filter(tag => !/\b(?:width|height)=/i.test(tag)).length
    if (missing > 0) {
      warnings.push(`${missing} immagini senza width/height — regola progetto: obbligatorio`)
    }
  }

  return { violations, warnings }
}
