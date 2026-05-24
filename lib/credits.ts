/**
 * Credits system: per-user token wallet for LLM calls.
 * - 1 credit = 1 token (Claude pricing). Markup applied at top-up time.
 * - Each LLM endpoint must call `precheckCredits` BEFORE the call and
 *   `consumeCredits` AFTER, with the actual input+output tokens.
 * - Insufficient balance → throws CreditsError (status 402, "paywall").
 */
import { ApiError, getServiceSupabase } from './api-auth'
import type { SupabaseClient } from '@supabase/supabase-js'

export const MIN_BALANCE_TO_START = 500 // minimum required to even attempt a call
export const SIGNUP_BONUS = 50_000

export class CreditsError extends ApiError {
  constructor(public balance: number) {
    super(402, 'Crediti insufficienti. Ricarica il tuo wallet per continuare.')
  }
}

export type CreditReason = 'chat' | 'seo-fix' | 'image-meta' | 'stripe-topup' | 'signup-bonus'

/** Read current balance (creates wallet with 0 if missing). */
export async function getBalance(userId: string, supabase?: SupabaseClient): Promise<number> {
  const sb = supabase ?? getServiceSupabase()
  const { data } = await sb.from('user_credits').select('balance_tokens').eq('user_id', userId).single()
  return data?.balance_tokens ?? 0
}

/**
 * Pre-check: throws CreditsError(402) if balance < MIN_BALANCE_TO_START.
 * Call BEFORE invoking the LLM. Doesn't reserve credits; we accept some burst
 * negative if the call costs more than the balance — the alternative
 * (reserving estimated tokens) is significantly more complex.
 */
export async function precheckCredits(userId: string, supabase?: SupabaseClient): Promise<number> {
  const balance = await getBalance(userId, supabase)
  if (balance < MIN_BALANCE_TO_START) {
    throw new CreditsError(balance)
  }
  return balance
}

/**
 * Atomic consume via the consume_credits RPC. Returns new balance.
 * If balance < tokens the RPC returns -1 and we throw CreditsError
 * (but the LLM call already happened — we eat the cost on rare overruns).
 */
export async function consumeCredits(
  userId: string,
  tokens: number,
  reason: CreditReason,
  projectId?: string | null,
  metadata?: Record<string, unknown>,
  supabase?: SupabaseClient,
): Promise<number> {
  if (tokens <= 0) return await getBalance(userId, supabase)
  const sb = supabase ?? getServiceSupabase()
  const { data, error } = await sb.rpc('consume_credits', {
    p_user_id: userId,
    p_tokens: tokens,
    p_reason: reason,
    p_project_id: projectId ?? null,
    p_metadata: metadata ?? null,
  })
  if (error) {
    console.error('[credits] consume error:', error)
    throw new ApiError(500, 'Errore consumo crediti')
  }
  const newBalance = Number(data)
  if (newBalance === -1) {
    throw new CreditsError(0)
  }
  return newBalance
}

/** Server-side top-up (used by Stripe webhook). */
export async function topupCredits(
  userId: string,
  tokens: number,
  reason: CreditReason,
  metadata?: Record<string, unknown>,
): Promise<number> {
  const sb = getServiceSupabase()
  const { data, error } = await sb.rpc('topup_credits', {
    p_user_id: userId,
    p_tokens: tokens,
    p_reason: reason,
    p_metadata: metadata ?? null,
  })
  if (error) {
    console.error('[credits] topup error:', error)
    throw new ApiError(500, 'Errore ricarica crediti')
  }
  return Number(data)
}
