// Fonte di verità unica per i workflow e le relazioni tra agenti.
// Importabile sia lato client (pipeline/page.tsx, agents/page.tsx) sia lato server (cron route).

export type WorkflowStepDef = {
  agentId: string
  optional?: boolean      // step condizionale (es. site-analyzer solo se URL)
  conditional?: boolean   // branch alternativo (es. html-template vs html)
  note?: string
  parallelWith?: string   // agentId con cui gira in parallelo
  triggersAgents?: string[] // agenti che questo triggera dopo (es. images → design, html, content, seo)
}

export type WorkflowDef = {
  id: string              // corrisponde all'AgentType nell'orchestratore
  name: string
  trigger: string         // keywords che lo attivano
  steps: WorkflowStepDef[]
}

export const WORKFLOWS: WorkflowDef[] = [
  {
    id: 'pipeline',
    name: '1 · Creazione sito',
    trigger: '«crea», «genera», «nuovo sito» — o nessun sito esistente',
    steps: [
      { agentId: 'clarifier', optional: true, note: 'chiede chiarimenti se richiesta ambigua' },
      { agentId: 'memory' },
      { agentId: 'planner' },
      { agentId: 'site-analyzer', optional: true, note: 'se URL ispirazione + screenshot' },
      { agentId: 'template-generator', optional: true, note: 'genera nuovo template da DesignBrief' },
      { agentId: 'content' },
      { agentId: 'design', parallelWith: 'content' },
      { agentId: 'html', conditional: true, note: 'senza template' },
      { agentId: 'html-template', conditional: true, note: 'con template business' },
    ],
  },
  {
    id: 'modify-site',
    name: '2 · Modifica sito',
    trigger: 'qualsiasi modifica su sito esistente — orchestratore sceglie il branch',
    steps: [
      { agentId: 'html', conditional: true, note: 'modifica HTML/struttura' },
      { agentId: 'design-update', conditional: true, note: 'aggiorna design' },
      { agentId: 'content-update', conditional: true, note: 'aggiorna contenuti' },
      { agentId: 'seo', conditional: true, note: 'ottimizzazione SEO' },
      {
        agentId: 'images',
        conditional: true,
        note: 'crea/modifica immagini',
        triggersAgents: ['design-update', 'html', 'content-update', 'seo'],
      },
    ],
  },
]

// Agenti speciali che non appartengono a un workflow specifico ma sono sempre presenti
export const ALWAYS_ON_AGENTS = ['orchestrator']

// Restituisce tutti gli agentId che compaiono in almeno un workflow
export function getWorkflowAgentIds(): Set<string> {
  const ids = new Set<string>()
  for (const workflow of WORKFLOWS) {
    for (const step of workflow.steps) {
      ids.add(step.agentId)
    }
  }
  return ids
}

// Restituisce i workflow in cui compare un agente
export function getAgentWorkflows(agentId: string): WorkflowDef[] {
  return WORKFLOWS.filter(w => w.steps.some(s => s.agentId === agentId))
}

// Restituisce gli agenti orfani (non in nessun workflow e non ALWAYS_ON)
// agentNames = lista nomi da AGENTS_MANIFEST
export function getOrphanAgents(agentNames: string[]): string[] {
  const workflowIds = getWorkflowAgentIds()
  return agentNames.filter(
    name => !workflowIds.has(name) && !ALWAYS_ON_AGENTS.includes(name)
  )
}

// SQL migration (eseguire manualmente su Supabase dashboard o via CLI):
// ALTER TABLE agent_configs ADD COLUMN orphaned_at TIMESTAMPTZ;
// ALTER TABLE agent_configs ADD COLUMN workflow_ids TEXT[] DEFAULT '{}';
