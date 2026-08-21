/**
 * Cron job: goes live any blog post whose scheduled go-live day has arrived.
 * Runs once a day via Vercel Cron (see vercel.json).
 *
 * Flips status 'scheduled' → 'published' for every post with
 * scheduled_at <= today, across all projects.
 *
 * IMPORTANT: this must NEVER write published_at. That field is the editorial/
 * SEO date the user chose in the builder sidebar (DATA PUBBLICAZIONE) and is
 * completely independent from scheduled_at (the go-live day). Touching it
 * here would silently re-date articles to "whenever the cron happened to
 * run" — exactly the bug this whole feature was built to avoid.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('blog_posts')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('status', 'scheduled')
    .lte('scheduled_at', today)
    .select('id, project_id, slug, scheduled_at, published_at')

  if (error) {
    console.error('[publish-scheduled-posts] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = data?.length ?? 0
  if (count > 0) {
    console.log(`[publish-scheduled-posts] published ${count} post(s):`, data?.map(p => `${p.slug}@${p.project_id}`))
  }

  return NextResponse.json({
    published: count,
    posts: data ?? [],
    today,
    timestamp: new Date().toISOString(),
  })
}
