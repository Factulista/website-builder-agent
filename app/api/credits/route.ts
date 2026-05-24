import { NextRequest, NextResponse } from 'next/server'
import { requireUser, jsonError } from '../../../lib/api-auth'
import { getBalance } from '../../../lib/credits'

export const runtime = 'nodejs'

// GET /api/credits — returns current balance for the authenticated user
export async function GET(req: NextRequest) {
  try {
    const { user, supabase } = await requireUser(req)
    const balance = await getBalance(user.id, supabase)
    return NextResponse.json({ balance })
  } catch (err) {
    return jsonError(err)
  }
}
