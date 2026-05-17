/*
 * SQL — run once in Supabase SQL Editor:
 *
 * CREATE TABLE agent_runs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   project_id TEXT,
 *   user_id TEXT,
 *   agent_type TEXT NOT NULL,
 *   status TEXT NOT NULL DEFAULT 'running',
 *   input_summary TEXT,
 *   output_summary TEXT,
 *   error_message TEXT,
 *   input_tokens INTEGER NOT NULL DEFAULT 0,
 *   output_tokens INTEGER NOT NULL DEFAULT 0,
 *   cache_read_tokens INTEGER NOT NULL DEFAULT 0,
 *   duration_ms INTEGER,
 *   model TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   completed_at TIMESTAMPTZ
 * );
 * CREATE INDEX agent_runs_created_at_idx ON agent_runs (created_at DESC);
 * CREATE INDEX agent_runs_agent_type_idx ON agent_runs (agent_type);
 * CREATE INDEX agent_runs_status_idx ON agent_runs (status);
 * CREATE INDEX agent_runs_project_id_idx ON agent_runs (project_id);
 */

import { createClient } from '@supabase/supabase-js'
import { computeCost } from './cost'

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type AgentRunStatus = 'running' | 'success' | 'error'

export type AgentRun = {
  id: string
  project_id: string | null
  user_id: string | null
  agent_type: string
  status: AgentRunStatus
  input_summary: string | null
  output_summary: string | null
  error_message: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  duration_ms: number | null
  model: string | null
  created_at: string
  completed_at: string | null
  cost_usd: number
}

export async function startRun(opts: {
  project_id?: string
  user_id?: string
  agent_type: string
  input_summary?: string
  model?: string
}): Promise<string> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      project_id: opts.project_id ?? null,
      user_id: opts.user_id ?? null,
      agent_type: opts.agent_type,
      status: 'running',
      input_summary: opts.input_summary ?? null,
      model: opts.model ?? null,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'startRun: no data returned')
  return data.id as string
}

export async function completeRun(
  runId: string,
  opts: {
    output_summary?: string
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    duration_ms?: number
  }
): Promise<void> {
  const supabase = getClient()
  await supabase
    .from('agent_runs')
    .update({
      status: 'success',
      output_summary: opts.output_summary ?? null,
      input_tokens: opts.input_tokens ?? 0,
      output_tokens: opts.output_tokens ?? 0,
      cache_read_tokens: opts.cache_read_tokens ?? 0,
      duration_ms: opts.duration_ms ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

export async function failRun(
  runId: string,
  opts: {
    error_message?: string
    duration_ms?: number
  }
): Promise<void> {
  const supabase = getClient()
  await supabase
    .from('agent_runs')
    .update({
      status: 'error',
      error_message: opts.error_message ?? null,
      duration_ms: opts.duration_ms ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

export async function listRuns(opts?: {
  agent_type?: string
  status?: string
  project_id?: string
  limit?: number
  offset?: number
  from_date?: string
  to_date?: string
}): Promise<{ runs: AgentRun[]; total: number }> {
  const supabase = getClient()
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0

  let query = supabase
    .from('agent_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (opts?.agent_type) query = query.eq('agent_type', opts.agent_type)
  if (opts?.status) query = query.eq('status', opts.status)
  if (opts?.project_id) query = query.eq('project_id', opts.project_id)
  if (opts?.from_date) query = query.gte('created_at', opts.from_date)
  if (opts?.to_date) query = query.lte('created_at', opts.to_date)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  const runs = (data ?? []).map((r: Omit<AgentRun, 'cost_usd'>) => ({
    ...r,
    cost_usd: computeCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens),
  })) as AgentRun[]
  return { runs, total: count ?? 0 }
}

export async function getRun(id: string): Promise<AgentRun | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  const r = data as Omit<AgentRun, 'cost_usd'>
  return {
    ...r,
    cost_usd: computeCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens),
  } as AgentRun
}

export async function getRunStats(): Promise<{
  byDay: Array<{ date: string; success: number; error: number; total: number }>
  totals: { success: number; error: number; running: number; total: number }
  tokens: { input: number; output: number; cache_read: number }
  avgDuration: number | null
  totalCost: number
}> {
  const supabase = getClient()

  // Last 7 days window
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const { data: recentRows } = await supabase
    .from('agent_runs')
    .select('created_at, status, input_tokens, output_tokens, cache_read_tokens, duration_ms')
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: true })

  // All-time totals
  const { data: allRows } = await supabase
    .from('agent_runs')
    .select('status, input_tokens, output_tokens, cache_read_tokens, duration_ms, model')

  // Build byDay from recent rows
  const dayMap: Record<string, { success: number; error: number; total: number }> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap[key] = { success: 0, error: 0, total: 0 }
  }

  for (const row of recentRows ?? []) {
    const key = (row.created_at as string).slice(0, 10)
    if (!dayMap[key]) continue
    dayMap[key].total++
    if (row.status === 'success') dayMap[key].success++
    if (row.status === 'error') dayMap[key].error++
  }

  const byDay = Object.entries(dayMap).map(([date, counts]) => ({ date, ...counts }))

  // Totals
  const totals = { success: 0, error: 0, running: 0, total: 0 }
  const tokens = { input: 0, output: 0, cache_read: 0 }
  let durationSum = 0
  let durationCount = 0
  let totalCost = 0

  for (const row of allRows ?? []) {
    totals.total++
    if (row.status === 'success') totals.success++
    else if (row.status === 'error') totals.error++
    else if (row.status === 'running') totals.running++

    const inp = row.input_tokens ?? 0
    const out = row.output_tokens ?? 0
    const cch = row.cache_read_tokens ?? 0
    tokens.input += inp
    tokens.output += out
    tokens.cache_read += cch
    totalCost += computeCost(row.model as string | null, inp, out, cch)

    if (row.duration_ms != null) {
      durationSum += row.duration_ms as number
      durationCount++
    }
  }

  return {
    byDay,
    totals,
    tokens,
    avgDuration: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    totalCost,
  }
}
