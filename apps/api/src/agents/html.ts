import { callClaude } from '../services/claude'

export async function htmlAgent(
  userMessage: string,
  content: any,
  projectState: any
): Promise<{
  html: string
  files: Record<string, string>
}> {
  const systemPrompt = `You are an HTML generator. Create semantic HTML5 that is SEO-friendly and accessible.

Generate a complete HTML page using classless CSS (Pico CSS).
Include the content provided.

Respond with valid JSON:
{
  "html": "<complete html page>",
  "files": {
    "pages/index.html": "<html>...",
    "meta/sitemap.json": {...}
  }
}`

  const contentStr = JSON.stringify(content)

  const response = await callClaude(
    'claude-sonnet-4-6',
    systemPrompt,
    `User request: ${userMessage}\n\nContent: ${contentStr}`
  )

  try {
    const result = JSON.parse(response)
    return result
  } catch {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${content.h1 || 'Welcome'}</title>
  <meta name="description" content="${content.metaDescription || 'Welcome'}">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico">
</head>
<body>
  <main>
    <h1>${content.h1 || 'Welcome'}</h1>
    <p>${content.body || userMessage}</p>
  </main>
</body>
</html>`

    return {
      html,
      files: {
        'pages/index.html': html,
      },
    }
  }
}
