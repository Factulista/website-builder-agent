export interface User {
  id: string
  email: string
  name: string
  created_at: string
}

export interface Project {
  id: string
  user_id: string
  name: string
  slug: string
  preview_url: string
  production_url: string
  custom_domain?: string
  created_at: string
}

export interface Conversation {
  id: string
  project_id: string
  title: string
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface AgentRun {
  id: string
  conversation_id: string
  project_id: string
  user_id: string
  status: 'in_progress' | 'complete' | 'failed'
  user_message: string
  assistant_message?: string
  seo_score?: number
  files_modified?: string[]
  created_at: string
}

export interface SiteConfig {
  palette: Record<string, string>
  typography: Record<string, string>
  brand_voice: string
  target_keywords: string[]
  geo_region?: string
}
