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

  // Current balance
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
    wallet: wallet ?? { balance_tokens: 0, updated_at: null },
    transactionCount: txs?.length ?? 0,
    totalsInLast20: totalsByReason,
    recentTransactions: txs ?? [],
  })
}
