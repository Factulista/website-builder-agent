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

  -- Migration 2: Aggiungi colonne metadati agli agent_configs
  ALTER TABLE agent_configs
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'utility',
    ADD COLUMN IF NOT EXISTS file_path TEXT,
    ADD COLUMN IF NOT EXISTS rules TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS inputs TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS outputs TEXT[] DEFAULT '{}';

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
  // Nuovi campi metadati (nullable — potrebbero non essere ancora migrati)
  display_name: string | null
  description: string | null
  category: string | null
  file_path: string | null
  rules: string[] | null
  inputs: string[] | null
  outputs: string[] | null
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

  // Se la tabella non esiste o c'è un errore grave, fai fallback al manifest
  if (error) {
    console.warn('[db-config] agent_configs read failed, falling back to manifest:', error.message)
    return manifestFallback()
  }

  const manifestNames = new Set(AGENTS_MANIFEST.map(a => a.name))

  // Prune stale agents: rows in the DB whose name is no longer in the manifest
  // (leftovers from old architectures — e.g. orchestrator, clarifier, planner).
  // The manifest is the source of truth for which agents exist; the seed step
  // below adds missing ones, this step removes ones that no longer exist.
  // Safe: callClaude falls back to the static AGENT_CONFIGS, never the DB row.
  let live = (existing ?? []) as DbAgentConfig[]
  const staleNames = live.filter(r => !manifestNames.has(r.name)).map(r => r.name)
  if (staleNames.length > 0) {
    const { error: pruneError } = await supabase
      .from('agent_configs')
      .delete()
      .in('name', staleNames)
    if (pruneError) {
      console.warn('[db-config] prune stale agents failed:', pruneError.message)
    } else {
      live = live.filter(r => manifestNames.has(r.name))
    }
  }

  const existingNames = new Set(live.map((r: DbAgentConfig) => r.name))

  // Seed any missing agents from manifest
  const toInsert = AGENTS_MANIFEST
    .filter(a => !existingNames.has(a.name))
    .map(a => ({
      name: a.name,
      model: a.model === 'rule-based' ? 'rule-based' : a.model,
      max_tokens: a.maxTokens,
      enabled: a.enabled,
      system_prompt: a.systemPromptPreview,
      // Metadati (potrebbero non esistere se Migration 2 non è stata eseguita)
      display_name: a.displayName,
      description: a.description,
      category: a.category,
      file_path: a.filePath,
      rules: a.rules ?? [],
      inputs: a.inputs,
      outputs: a.outputs,
    }))

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('agent_configs')
      .insert(toInsert)

    if (insertError) {
      // Migration 2 potrebbe non essere stata eseguita: riprova senza colonne metadati
      console.warn('[db-config] full seed failed, retrying without metadata columns:', insertError.message)
      const basicInsert = toInsert.map(a => ({
        name: a.name,
        model: a.model,
        max_tokens: a.max_tokens,
        enabled: a.enabled,
        system_prompt: a.system_prompt,
      }))
      const { error: basicError } = await supabase.from('agent_configs').insert(basicInsert)
      if (basicError) {
        console.warn('[db-config] basic seed also failed:', basicError.message)
        // Restituisci comunque quelli già presenti + manifest come fallback per i nuovi
        return mergeWithManifest(live)
      }
    }

    // Re-fetch after insert
    const { data: fresh, error: freshError } = await supabase
      .from('agent_configs')
      .select('*')
    if (freshError) {
      console.warn('[db-config] re-fetch failed:', freshError.message)
      return mergeWithManifest(live)
    }
    return (fresh ?? []) as DbAgentConfig[]
  }

  return live
}

/** Converte il manifest in DbAgentConfig per usarlo come fallback quando il DB non è disponibile */
function manifestFallback(): DbAgentConfig[] {
  return AGENTS_MANIFEST.map(a => ({
    name: a.name,
    model: a.model,
    max_tokens: a.maxTokens,
    enabled: a.enabled,
    system_prompt: a.systemPromptPreview,
    updated_at: new Date().toISOString(),
    display_name: a.displayName,
    description: a.description,
    category: a.category,
    file_path: a.filePath,
    rules: a.rules ?? [],
    inputs: a.inputs,
    outputs: a.outputs,
  }))
}

/** Merge DB rows con il manifest per riempire gli agenti mancanti */
function mergeWithManifest(dbRows: DbAgentConfig[]): DbAgentConfig[] {
  const dbNames = new Set(dbRows.map(r => r.name))
  const missing = manifestFallback().filter(a => !dbNames.has(a.name))
  return [...dbRows, ...missing]
}

export async function syncAgentMetadata(): Promise<void> {
  const supabase = getSupabase()

  for (const meta of AGENTS_MANIFEST) {
    // Aggiorna metadati solo se display_name è null (non ancora migrato)
    await supabase
      .from('agent_configs')
      .update({
        display_name: meta.displayName,
        description: meta.description,
        category: meta.category,
        file_path: meta.filePath,
        rules: meta.rules ?? [],
        inputs: meta.inputs,
        outputs: meta.outputs,
      })
      .eq('name', meta.name)
      .is('display_name', null)  // solo se non ancora impostato
  }
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
  patch: Partial<Pick<DbAgentConfig, 'model' | 'max_tokens' | 'enabled' | 'system_prompt' | 'display_name' | 'description' | 'category' | 'file_path' | 'rules' | 'inputs' | 'outputs'>>
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
