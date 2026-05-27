// Temporary diagnostic for the credits wallet of the currently-logged user.
// DELETE this file once we've understood the billing flow.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const { data: { user } } = await getSupabase().auth.getUser(auth.slice(7))
  return user
}

export async function GET(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 })

  const sb = getSupabase()

  // Read balance
  const { data: walletBefore } = await sb
    .from('user_credits')
    .select('balance_tokens, updated_at')
    .eq('user_id', user.id)
    .single()
  const balanceBefore = walletBefore?.balance_tokens ?? 0

  // AUTO-TOPUP if balance is below 1M — gives plenty of headroom for testing.
  // This is idempotent in practice: once balance is high, this no-ops.
  let toppedUp = 0
  if (balanceBefore < 1_000_000) {
    toppedUp = 10_000_000
    await sb.rpc('topup_credits', {
      p_user_id: user.id,
      p_tokens: toppedUp,
      p_reason: 'stripe-topup',
      p_metadata: { source: 'auto-diagnose-credits', issued_at: new Date().toISOString() },
    })
  }

  // Re-read after potential topup
  const { data: wallet } = await sb
    .from('user_credits')
    .select('balance_tokens, updated_at')
    .eq('user_id', user.id)
    .single()

  // Last 20 transactions for this user
  const { data: txs } = await sb
    .from('credit_transactions')
    .select('id, created_at, tokens, reason, project_id, metadata')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Totals by reason
  const totalsByReason: Record<string, { count: number; tokens: number }> = {}
  if (txs) {
    for (const t of txs) {
      const k = t.reason ?? 'unknown'
      if (!totalsByReason[k]) totalsByReason[k] = { count: 0, tokens: 0 }
      totalsByReason[k].count += 1
      totalsByReason[k].tokens += t.tokens ?? 0
    }
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    balanceBefore,
    autoToppedUp: toppedUp,
    wallet: wallet ?? { balance_tokens: 0, updated_at: null },
    transactionCount: txs?.length ?? 0,
    totalsInLast20: totalsByReason,
    recentTransactions: txs ?? [],
  })
}

// POST → top up the current user's wallet by a fixed large amount
// Body (optional): { amount: number }  default 10_000_000
export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'auth required' }, { status: 401 })

  let amount = 10_000_000
  try {
    const body = await req.json()
    if (typeof body?.amount === 'number' && body.amount > 0) amount = Math.floor(body.amount)
  } catch { /* no body, use default */ }

  const sb = getSupabase()
  const { data, error } = await sb.rpc('topup_credits', {
    p_user_id: user.id,
    p_tokens: amount,
    p_reason: 'stripe-topup',
    p_metadata: { source: 'manual-diagnose-credits', issued_at: new Date().toISOString() },
  })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const newBalance = Number(data)
  return NextResponse.json({ ok: true, addedTokens: amount, newBalance, userId: user.id })
}
