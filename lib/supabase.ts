import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseInstance: SupabaseClient | null = null

/**
 * Lazy-load Supabase client to avoid initialization errors during build/prerender
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }

    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey)
  }
  return supabaseInstance
}

/**
 * Proxy that lazy-loads the Supabase client for backwards compatibility.
 * This allows existing code using `import { supabase }` to work transparently
 * while deferring initialization until first use.
 */
export const supabase = new Proxy(
  {},
  {
    get(target, prop) {
      return (getSupabase() as any)[prop]
    },
  }
) as SupabaseClient
