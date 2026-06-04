/**
 * Rules Learner Agent — automatically detects project conventions.
 *
 * Runs once per project (or on manual trigger) to extract rules from:
 * - Existing page HTML patterns
 * - Project context (language, business type)
 * - Quality checks and agent corrections (learning from feedback)
 *
 * The learned rules feed into all agents, making the system adaptive.
 */

import { learnRulesFromPages, mergeRules, DEFAULT_FACTULISTA_RULES, type ProjectRules } from './project-rules'

export interface RulesLearnerInput {
  pages: Array<{ slug: string; html: string; name: string }>
  context?: {
    language?: string
    businessType?: string
    businessName?: string
  }
  qualityCheckResults?: Array<{
    pageSlug: string
    critical: string[]
    warnings: string[]
  }>
}

export interface RulesLearnerOutput {
  rules: ProjectRules
  summary: string
  changedFrom: Partial<ProjectRules>
}

/**
 * Learn project rules from existing pages and context.
 * Returns the merged rules (defaults + learned).
 */
export async function runRulesLearner(input: RulesLearnerInput): Promise<RulesLearnerOutput> {
  // Start with Factulista defaults
  const defaults = { ...DEFAULT_FACTULISTA_RULES }

  // Update context from input
  if (input.context?.language) defaults.context.language = input.context.language
  if (input.context?.businessType) defaults.context.businessType = input.context.businessType
  if (input.context?.businessName) defaults.context.businessName = input.context.businessName

  // Learn from existing pages
  const learned = learnRulesFromPages(input.pages)

  // Merge: learned + defaults
  const merged = mergeRules(defaults, learned)

  // Learn from quality check results (patterns in corrections)
  if (input.qualityCheckResults && input.qualityCheckResults.length > 0) {
    const learnedFromQuality = learnFromQualityChecks(input.qualityCheckResults, merged)
    Object.assign(merged._learned!.learnedFrom!, learnedFromQuality.learnedFrom)
  }

  // Generate summary
  const summary = generateLearningSummary(merged, defaults)

  return {
    rules: merged,
    summary,
    changedFrom: learned,
  }
}

/**
 * Extract patterns from quality check results to refine rules.
 * E.g., if all pages fail with "absolute links", enforce relative links rule.
 */
function learnFromQualityChecks(
  results: Array<{ pageSlug: string; critical: string[]; warnings: string[] }>,
  currentRules: ProjectRules
): { learnedFrom: Record<string, string> } {
  const learnedFrom: Record<string, string> = {}

  const allCritical = results.flatMap(r => r.critical).join(' ').toLowerCase()
  const allWarnings = results.flatMap(r => r.warnings).join(' ').toLowerCase()
  const all = (allCritical + ' ' + allWarnings).toLowerCase()

  // If >50% of pages fail on absolute links, strongly enforce relative links
  if (all.includes('link assoluti') && results.length > 2) {
    learnedFrom['links_relative'] = 'quality_check_pattern_detected'
  }

  // If multiple pages fail on H1 count, enforce single H1
  if (allCritical.includes('h1') && results.length > 1) {
    learnedFrom['html_singleH1'] = 'consistent_quality_issue_detected'
  }

  // If images consistently lack alt/dimensions, make them required
  if (allWarnings.includes('alt') || allWarnings.includes('width/height')) {
    learnedFrom['images_metadata'] = 'recurring_accessibility_issue'
  }

  return { learnedFrom }
}

/**
 * Generate a human-readable summary of what was learned.
 */
function generateLearningSummary(merged: ProjectRules, defaults: ProjectRules): string {
  const changes: string[] = []

  // Check what changed from defaults
  if (merged.links.relative !== defaults.links.relative) {
    changes.push(`• Link style: ${merged.links.relative ? 'relative (./ )' : 'absolute (/)'}`)
  }

  if (merged.forms.endpoint !== defaults.forms.endpoint) {
    changes.push(`• Form endpoint: ${merged.forms.endpoint}`)
  }

  if (merged.styling.useTailwind !== defaults.styling.useTailwind) {
    changes.push(`• CSS approach: ${merged.styling.useTailwind ? 'Tailwind' : 'CSS custom'}`)
  }

  if (merged.styling.mobileMenuToggleClass !== defaults.styling.mobileMenuToggleClass) {
    changes.push(`• Mobile menu toggle: class="${merged.styling.mobileMenuToggleClass}"`)
  }

  if (merged.images.storage !== defaults.images.storage) {
    changes.push(`• Image storage: ${merged.images.storage}`)
  }

  if (merged.content.noBlogAutoCreate !== defaults.content.noBlogAutoCreate) {
    changes.push(`• Blog auto-create: ${merged.content.noBlogAutoCreate ? 'disabled' : 'enabled'}`)
  }

  const confidence = merged._learned?.confidence || {}
  const avgConfidence = Object.values(confidence).length > 0
    ? Math.round(Object.values(confidence).reduce((a, b) => a + b, 0) / Object.values(confidence).length)
    : 0

  const summary = changes.length > 0
    ? `Appreso dai dati del progetto (confidenza media ${avgConfidence}%):\n${changes.join('\n')}`
    : `Nessun pattern rilevato — usiamo le impostazioni predefinite di Factulista.`

  return summary
}

/**
 * Lightweight version: just detect major conventions quickly.
 * Used during onboarding or quick audits.
 */
export function quickLearnRules(pages: Array<{ slug: string; html: string }>): Partial<ProjectRules> {
  if (pages.length === 0) return {}

  const allHtml = pages.map(p => p.html).join('\n')

  const result: Partial<ProjectRules> = {}

  // Quick link detection
  const relLinks = (allHtml.match(/href="\.\//g) ?? []).length
  const absLinks = (allHtml.match(/href="\/[^./]/g) ?? []).length
  if (relLinks > absLinks) {
    result.links = { relative: true }
  }

  // Quick form detection
  const formAction = allHtml.match(/action=["']([^"']+)["']/i)?.[1]
  if (formAction) {
    const fields = [...new Set((allHtml.match(/name=["']([^"']+)["']/gi) ?? []).map(m => m.match(/name=["']([^"']+)["']/i)?.[1]).filter((f): f is string => f !== undefined))]
    result.forms = { endpoint: formAction, fields }
  }

  // Quick CSS detection
  const hasTailwind = /\bclass="[^"]*\b(?:text-|font-|px-|py-)[^\s"]*\b/.test(allHtml)
  if (!hasTailwind) {
    result.styling = { useTailwind: false, cssVarPrefix: '--', allowInlineStyles: false, mobileMenuToggleClass: 'open' }
  }

  return result
}
