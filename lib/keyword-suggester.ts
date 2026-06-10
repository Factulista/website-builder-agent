/**
 * Suggest relevant keywords for a blog post based on its title/topic.
 * Matches against the project's keyword database.
 */

export type SeoKeyword = {
  keyword: string
  volume: number
  difficulty: number
  intent?: string
}

/**
 * Score a keyword match against article title/topic.
 * Returns 0-100 where 100 is perfect match.
 */
function scoreKeywordMatch(keyword: string, title: string, topic?: string): number {
  const titleLower = title.toLowerCase()
  const topicLower = (topic ?? '').toLowerCase()
  const searchText = `${titleLower} ${topicLower}`.trim()

  // Exact word match = 100
  if (searchText.includes(keyword.toLowerCase())) return 100

  // Word starts with keyword = 80
  const words = searchText.split(/\s+/)
  if (words.some(w => w.startsWith(keyword.toLowerCase().split(' ')[0]))) return 80

  // Keyword word appears in title = 60
  const kwWords = keyword.toLowerCase().split(/\s+/)
  const titleWords = titleLower.split(/\s+/)
  const matchingWords = kwWords.filter(kw => titleWords.some(tw => tw.includes(kw)))
  if (matchingWords.length > 0) return 60 + (matchingWords.length * 5)

  return 0
}

/**
 * Suggest keywords for an article based on title.
 * Returns top 8 keyword suggestions sorted by relevance.
 */
export function suggestKeywordsForArticle(
  title: string,
  keywords: SeoKeyword[],
  topic?: string,
  limit: number = 8
): SeoKeyword[] {
  if (!keywords.length || !title.trim()) return []

  // Score each keyword
  const scored = keywords
    .map(kw => ({
      ...kw,
      score: scoreKeywordMatch(kw.keyword, title, topic),
    }))
    .filter(kw => kw.score > 0)
    .sort((a, b) => {
      // Primary: relevance score
      if (b.score !== a.score) return b.score - a.score
      // Secondary: volume (more searches = better)
      return b.volume - a.volume
    })
    .slice(0, limit)

  return scored.map(({ score, ...kw }) => kw)
}

/**
 * Filter keywords by intent type.
 * Useful for article selection (Informational, Commercial, etc).
 */
export function filterKeywordsByIntent(
  keywords: SeoKeyword[],
  intent: string
): SeoKeyword[] {
  return keywords.filter(kw => kw.intent?.toLowerCase().includes(intent.toLowerCase()))
}

/**
 * Sort keywords by volume (descending).
 */
export function sortByVolume(keywords: SeoKeyword[]): SeoKeyword[] {
  return [...keywords].sort((a, b) => b.volume - a.volume)
}
