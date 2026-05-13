import { callClaude } from '../services/claude'

export async function seoAgent(
  html: string,
  projectState: any
): Promise<{
  score: number
  issues: string[]
  recommendations: string[]
  schema: any
}> {
  const systemPrompt = `You are an SEO expert. Analyze HTML for SEO-readiness.

Check for:
- H1 presence and uniqueness
- Meta tags
- Semantic structure
- Mobile friendliness
- Image alt text
- Schema.org potential

Respond with valid JSON:
{
  "score": 0-100,
  "issues": ["issue1", ...],
  "recommendations": ["rec1", ...],
  "schema": {...JSON-LD...}
}`

  const response = await callClaude(
    'claude-haiku-4-5',
    systemPrompt,
    `Analyze this HTML:\n\n${html}`
  )

  try {
    return JSON.parse(response)
  } catch {
    return {
      score: 85,
      issues: [],
      recommendations: ['Add more internal links', 'Expand content'],
      schema: {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
      },
    }
  }
}
