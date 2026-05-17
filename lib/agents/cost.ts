// Pricing per million tokens (USD)
// Source: https://www.anthropic.com/pricing
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00,  cacheRead: 0.08 },
  'claude-sonnet-4-5-20251001': { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'claude-opus-4-5-20251001':   { input: 15.00, output: 75.00, cacheRead: 1.50 },
  // Haiku 3 fallback (matches the $0.25/$1.25 numbers the user referenced)
  'claude-haiku-3':             { input: 0.25,  output: 1.25,  cacheRead: 0.03 },
}

const DEFAULT_PRICING = PRICING['claude-haiku-4-5-20251001']

function getPricing(model: string | null) {
  if (!model) return DEFAULT_PRICING
  // Exact match first
  if (PRICING[model]) return PRICING[model]
  // Partial match (e.g. model name without date suffix)
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.includes(key) || key.includes(model)) return price
  }
  // Fallback by model family
  if (model.includes('opus'))   return PRICING['claude-opus-4-5-20251001']
  if (model.includes('sonnet')) return PRICING['claude-sonnet-4-5-20251001']
  return DEFAULT_PRICING
}

/** Returns cost in USD */
export function computeCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  const p = getPricing(model)
  return (
    (inputTokens    * p.input     +
     outputTokens   * p.output    +
     cacheReadTokens * p.cacheRead) / 1_000_000
  )
}

/** Format cost for display: "$0.0023" or "$1.24" */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01)   return `$${usd.toFixed(4)}`
  if (usd < 1)      return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** Format large cost totals */
export function formatCostTotal(usd: number): string {
  if (usd < 0.01)  return `$${usd.toFixed(4)}`
  if (usd < 10)    return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
