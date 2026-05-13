import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function getUser(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createProject(userId: string, name: string, slug: string) {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name,
      slug,
      preview_url: `${slug}.preview.tuapiattaforma.com`,
      production_url: `${slug}.tuapiattaforma.com`,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getProject(projectId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (error) throw error
  return data
}

export async function createConversation(projectId: string, title: string) {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      project_id: projectId,
      title,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  agentRunId?: string
) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      agent_run_id: agentRunId,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createAgentRun(
  conversationId: string,
  projectId: string,
  userId: string,
  userMessage: string
) {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      conversation_id: conversationId,
      project_id: projectId,
      user_id: userId,
      user_message: userMessage,
      status: 'in_progress',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateAgentRun(
  agentRunId: string,
  updates: Record<string, any>
) {
  const { data, error } = await supabase
    .from('agent_runs')
    .update(updates)
    .eq('id', agentRunId)
    .select()
    .single()

  if (error) throw error
  return data
}
