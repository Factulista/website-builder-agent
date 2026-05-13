import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function callClaude(
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' = 'claude-sonnet-4-6',
  systemPrompt: string,
  userMessage: string,
  thinking: boolean = false
) {
  const messages = [
    {
      role: 'user' as const,
      content: userMessage,
    },
  ]

  const params: any = {
    model,
    max_tokens: thinking ? 8000 : 2000,
    system: systemPrompt,
    messages,
  }

  if (thinking && model === 'claude-opus-4-7') {
    params.thinking = {
      type: 'enabled',
      budget_tokens: 5000,
    }
  }

  const response = await client.messages.create(params)

  let textContent = ''
  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text
    }
  }

  return textContent
}

export async function* callClaudeStream(
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' = 'claude-sonnet-4-6',
  systemPrompt: string,
  userMessage: string
) {
  const stream = await client.messages.create({
    model,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
    stream: true,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
