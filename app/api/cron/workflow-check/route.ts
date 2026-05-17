import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AGENTS_MANIFEST } from '../../../../lib/agents/manifest'
import { getOrphanAgents, getWorkflowAgentIds } from '../../../../lib/agents/workflow-registry'

export async function GET(req: NextRequest) {
  // 1. Verifica CRON_SECRET se presente
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 2. Ottieni tutti i nomi degli agenti dal manifest
  const agentNames = AGENTS_MANIFEST.map(a => a.name)

  // 3. Calcola orfani con getOrphanAgents()
  const orphaned = getOrphanAgents(agentNames)
  const workflowIds = getWorkflowAgentIds()

  const timestamp = new Date().toISOString()
  const reactivated: string[] = []

  // 4. Per ogni orfano: set enabled=false, orphaned_at=now() se non già orfano
  if (orphaned.length > 0) {
    const { error: orphanError } = await supabase
      .from('agent_configs')
      .update({ enabled: false, orphaned_at: timestamp })
      .in('name', orphaned)
      .is('orphaned_at', null)

    if (orphanError) {
      console.error('[workflow-check] Errore aggiornamento orfani:', orphanError.message)
      return Response.json({ error: orphanError.message }, { status: 500 })
    }
  }

  // 5. Per ogni agente IN workflow: se orphaned_at IS NOT NULL, reset orphaned_at=NULL
  const workflowAgentArray = Array.from(workflowIds)
  if (workflowAgentArray.length > 0) {
    const { data: toReactivate, error: fetchError } = await supabase
      .from('agent_configs')
      .select('name')
      .in('name', workflowAgentArray)
      .not('orphaned_at', 'is', null)

    if (fetchError) {
      console.error('[workflow-check] Errore fetch riattivati:', fetchError.message)
      return Response.json({ error: fetchError.message }, { status: 500 })
    }

    if (toReactivate && toReactivate.length > 0) {
      const namesToReactivate = toReactivate.map((r: { name: string }) => r.name)

      const { error: reactivateError } = await supabase
        .from('agent_configs')
        .update({ orphaned_at: null })
        .in('name', namesToReactivate)

      if (reactivateError) {
        console.error('[workflow-check] Errore riattivazione:', reactivateError.message)
        return Response.json({ error: reactivateError.message }, { status: 500 })
      }

      reactivated.push(...namesToReactivate)
    }
  }

  // 6. Report finale
  const report = {
    checked: agentNames.length,
    orphaned,
    reactivated,
    timestamp,
  }

  // 7. Log (Vercel lo cattura nei function logs)
  console.log('[workflow-check]', JSON.stringify(report))

  return Response.json(report)
}
