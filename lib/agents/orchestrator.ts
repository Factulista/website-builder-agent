type AgentType = 'html' | 'seo' | 'content'

const SEO_KEYWORDS = [
  'seo', 'meta', 'title tag', 'description', 'keywords', 'sitemap',
  'robots', 'canonical', 'og:', 'open graph', 'indicizzazione', 'google',
  'posizionamento', 'rank', 'ottimizza seo', 'migliora seo',
]

const CONTENT_KEYWORDS = [
  'testo', 'copy', 'contenuto', 'scrivi', 'riscrivi', 'paragrafo',
  'slogan', 'headline', 'proposta di valore', 'bio', 'descrizione azienda',
]

export function classify(userMessage: string): AgentType {
  const lower = userMessage.toLowerCase()

  if (SEO_KEYWORDS.some(k => lower.includes(k))) return 'seo'
  if (CONTENT_KEYWORDS.some(k => lower.includes(k))) return 'content'
  return 'html'
}
