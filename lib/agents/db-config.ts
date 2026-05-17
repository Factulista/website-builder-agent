/*
  SQL — Run in Supabase SQL Editor before using this module:

  CREATE TABLE agent_configs (
    name TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    max_tokens INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    system_prompt TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE agent_prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL REFERENCES agent_configs(name) ON DELETE CASCADE,
    system_prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    max_tokens INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    label TEXT
  );
*/

import { createClient } from '@supabase/supabase-js'
import { AGENTS_MANIFEST } from './manifest'

export type DbAgentConfig = {
  name: string
  model: string
  max_tokens: number
  enabled: boolean
  system_prompt: string | null
  updated_at: string
}

export type PromptVersion = {
  id: string
  agent_name: string
  system_prompt: string
  model: string
  max_tokens: number
  created_at: string
  label: string | null
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function getAgentConfigs(): Promise<DbAgentConfig[]> {
  const supabase = getSupabase()

  const { data: existing, error } = await supabase
    .from('agent_configs')
    .select('*')

  if (error) throw new Error(`getAgentConfigs: ${error.message}`)

  const existingNames = new Set((existing ?? []).map((r: DbAgentConfig) => r.name))

  // Seed any missing agents from manifest
  const toInsert = AGENTS_MANIFEST
    .filter(a => !existingNames.has(a.name))
    .map(a => ({
      name: a.name,
      model: a.model === 'rule-based' ? 'rule-based' : a.model,
      max_tokens: a.maxTokens,
      enabled: a.enabled,
      system_prompt: a.systemPromptPreview,
    }))

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('agent_configs')
      .insert(toInsert)
    if (insertError) throw new Error(`getAgentConfigs seed: ${insertError.message}`)
  }

  // Re-fetch after potential insert
  if (toInsert.length > 0) {
    const { data: fresh, error: freshError } = await supabase
      .from('agent_configs')
      .select('*')
    if (freshError) throw new Error(`getAgentConfigs re-fetch: ${freshError.message}`)
    return (fresh ?? []) as DbAgentConfig[]
  }

  return (existing ?? []) as DbAgentConfig[]
}

export async function getAgentConfig(name: string): Promise<DbAgentConfig | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('name', name)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // not found
    throw new Error(`getAgentConfig: ${error.message}`)
  }

  return data as DbAgentConfig
}

export async function updateAgentConfig(
  name: string,
  patch: Partial<Pick<DbAgentConfig, 'model' | 'max_tokens' | 'enabled' | 'system_prompt'>>
): Promise<DbAgentConfig> {
  const supabase = getSupabase()

  // Fetch current config to check if system_prompt is changing
  const current = await getAgentConfig(name)

  if (!current) {
    throw new Error(`Agent config "${name}" not found`)
  }

  const promptChanging =
    'system_prompt' in patch &&
    patch.system_prompt !== undefined &&
    patch.system_prompt !== current.system_prompt

  // Save a version snapshot of what we are about to save (new values)
  if (promptChanging) {
    const versionPayload = {
      agent_name: name,
      system_prompt: patch.system_prompt ?? current.system_prompt ?? '',
      model: patch.model ?? current.model,
      max_tokens: patch.max_tokens ?? current.max_tokens,
      label: null as string | null,
    }
    const { error: versionError } = await supabase
      .from('agent_prompt_versions')
      .insert(versionPayload)
    if (versionError) throw new Error(`updateAgentConfig version insert: ${versionError.message}`)
  }

  const { data, error } = await supabase
    .from('agent_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('name', name)
    .select('*')
    .single()

  if (error) throw new Error(`updateAgentConfig: ${error.message}`)

  return data as DbAgentConfig
}

export async function getPromptVersions(agentName: string): Promise<PromptVersion[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_prompt_versions')
    .select('*')
    .eq('agent_name', agentName)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(`getPromptVersions: ${error.message}`)

  return (data ?? []) as PromptVersion[]
}
