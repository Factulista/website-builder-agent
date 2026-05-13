import { callClaude } from '../services/claude'

export async function contentAgent(
  userMessage: string,
  projectState: any
): Promise<{
  h1: string
  metaDescription: string
  body: string
  keywords: string[]
}> {
  const systemPrompt = `You are a content writer for SEO-optimized websites.
Generate compelling content that ranks well in search engines.

Respond with valid JSON:
{
  "h1": "main heading",
  "metaDescription": "compelling meta description under 160 chars",
  "body": "main content in markdown",
  "keywords": ["keyword1", "keyword2", ...]
}`

  const response = await callClaude(
    'claude-sonnet-4-6',
    systemPrompt,
    userMessage
  )

  try {
    return JSON.parse(response)
  } catch {
    return {
      h1: 'Welcome to Our Site',
      metaDescription: 'Discover amazing content',
      body: userMessage,
      keywords: [],
    }
  }
}
