import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireInternalSecret } from '../../../../lib/api-auth'
export const runtime = 'nodejs'
function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
// One-off: confirms whether the 20260831_support_articles.sql migration has been run.
export async function GET(req: NextRequest) {
  const authErr = requireInternalSecret(req)
  if (authErr) return authErr
  const supabase = getSupabase()
  const { error } = await supabase.from('support_articles').select('id').limit(1)
  const { error: rpcError } = await supabase.rpc('search_support_articles', { p_project_id: '00000000-0000-0000-0000-000000000000', p_query: 'test' })
  return NextResponse.json({
    table_exists: !error,
    table_error: error?.message ?? null,
    rpc_exists: !rpcError,
    rpc_error: rpcError?.message ?? null,
  })
}
