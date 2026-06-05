// Fonte di verità unica per i workflow e le relazioni tra agenti.
// Importabile sia lato client (pipeline/page.tsx, agents/page.tsx) sia lato server.
//
// ARCHITETTURA ATTUALE (giugno 2025): Master Agent
// Non esiste più un pipeline multi-stage. Un singolo HTML Agent (Sonnet 4.6)
// gestisce creazione e modifica, con agenti background non-bloccanti in parallelo.

export type WorkflowStepDef = {
  agentId: string
  optional?: boolean      // step condizionale
  conditional?: boolean   // branch alternativo
  background?: boolean    // non-blocking — gira in parallelo senza bloccare la risposta
  note?: string
  parallelWith?: string   // agentId con cui gira in parallelo
  triggersAgents?: string[]
}

export type WorkflowDef = {
  id: string
  name: string
  trigger: string
  steps: WorkflowStepDef[]
}

export const WORKFLOWS: WorkflowDef[] = [
  {
    id: 'create-site',
    name: '1 · Creazione sito',
    trigger: 'Nessuna pagina esistente — «crea», «genera», «nuovo sito»',
    steps: [
      {
        agentId: 'html',
        note: 'Sonnet 4.6 + extended thinking (8k) + design principles',
      },
      {
        agentId: 'quality-loop',
        note: 'server-side: H1, links, Tailwind, forms — retry automatico',
      },
      {
        agentId: 'design-extractor',
        background: true,
        note: 'estrae palette + tipografia → popola Design System panel',
      },
      {
        agentId: 'memory',
        background: true,
        parallelWith: 'session-memory',
        note: 'aggiorna business context (business type, lingua, servizi)',
      },
      {
        agentId: 'session-memory',
        background: true,
        parallelWith: 'memory',
        note: 'aggiorna design diary (palette scelta, font, struttura)',
      },
      {
        agentId: 'rules-learner',
        background: true,
        note: 'prima run: apprende convenzioni del progetto',
      },
    ],
  },
  {
    id: 'modify-site',
    name: '2 · Modifica sito',
    trigger: 'Pagine esistenti — qualsiasi richiesta di modifica',
    steps: [
      {
        agentId: 'html',
        conditional: true,
        note: 'Haiku (micro-edit) | Sonnet (edit_page / add_page)',
      },
      {
        agentId: 'quality-loop',
        optional: true,
        note: 'solo su edit_page / create_site — skip su micro-edit',
      },
      {
        agentId: 'memory',
        background: true,
        parallelWith: 'session-memory',
        note: 'aggiorna contesto se nuove info nel messaggio',
      },
      {
        agentId: 'session-memory',
        background: true,
        parallelWith: 'memory',
        note: 'aggiorna diary (correzioni ricevute, nuove decisioni)',
      },
    ],
  },
  {
    id: 'seo',
    name: '3 · SEO',
    trigger: 'Richiesta esplicita: «ottimizza SEO», «migliora meta», «sitemap»',
    steps: [
      {
        agentId: 'seo',
        note: 'Haiku — meta tags, sitemap, robots.txt, schema.org',
      },
    ],
  },
]

// Agenti che girano su ogni turno (non in nessun workflow specifico)
export const ALWAYS_ON_AGENTS: string[] = []

// Agenti background — girano in parallelo dopo la risposta principale
export const BACKGROUND_AGENTS = ['memory', 'session-memory', 'rules-learner', 'design-extractor']

export function getWorkflowAgentIds(): Set<string> {
  const ids = new Set<string>()
  for (const workflow of WORKFLOWS) {
    for (const step of workflow.steps) ids.add(step.agentId)
  }
  return ids
}

export function getAgentWorkflows(agentId: string): WorkflowDef[] {
  return WORKFLOWS.filter(w => w.steps.some(s => s.agentId === agentId))
}

export function getOrphanAgents(agentNames: string[]): string[] {
  const workflowIds = getWorkflowAgentIds()
  return agentNames.filter(
    name => !workflowIds.has(name) && !ALWAYS_ON_AGENTS.includes(name)
  )
}
