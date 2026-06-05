// Static manifest of all agents in the system.
// In Fase 2 this will be replaced by a DB-driven config (agent_configs table)
// so the back office can edit prompts/models without redeploy.

export type AgentMeta = {
  name: string
  displayName: string
  description: string
  model: string
  maxTokens: number
  category: 'orchestration' | 'pipeline' | 'modifier' | 'background' | 'utility'
  inputs: string[]
  outputs: string[]
  systemPromptPreview: string
  filePath: string
  enabled: boolean
  rules?: string[]  // Regole operative visibili in back office (read-only)
}

export const AGENTS_MANIFEST: AgentMeta[] = [
  {
    name: 'memory',
    displayName: 'Memory Agent',
    description: 'Mantiene il contesto del progetto tra le conversazioni (business type, target, tone of voice).',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    category: 'background',
    inputs: ['conversation history', 'existing context'],
    outputs: ['updated project context'],
    systemPromptPreview: 'Estrai informazioni chiave sul progetto dell\'utente (settore, target, tono) e aggiorna il contesto persistente.',
    filePath: 'lib/agents/memory-agent.ts',
    enabled: true,
    rules: [
      'Gira in background ad ogni messaggio, non blocca la pipeline',
      'Estrae: business type, target audience, tone of voice, preferenze di stile',
      'Non genera HTML, solo aggiorna il contesto JSON del progetto',
      'Il contesto prodotto viene passato a tutti gli altri agenti',
    ],
  },
  {
    name: 'html',
    displayName: 'Master HTML Agent',
    description: 'Agente master unico che crea siti da zero, modifica pagine, usa template, analizza ispirazione. Massima libertà creativa + quality feedback loop integrato.',
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    category: 'orchestration',
    inputs: [
      'user message',
      'existing pages (se presenti)',
      'project context + projectRules',
      'project media library',
      'inspiration URL + screenshots (se presenti)',
      'available templates (if any)',
    ],
    outputs: ['HTML pages (create_site / edit_page / add_page / delete_page)'],
    systemPromptPreview: 'Master agent autonomo. Crea design + HTML da zero, modifica puntualmente, utilizza template/ispirazione se disponibili. Applica project rules e feedback loop.',
    filePath: 'lib/agents/html-agent.ts',
    enabled: true,
    rules: [
      '🔍 LOOP AGENTICO — prima di modificare può chiamare search_html / read_page (sola lettura) per trovare l\'elemento esatto, fino a 4 ispezioni, poi agisce. Non indovina più alla cieca',
      '🎯 MASSIMA LIBERTÀ CREATIVA — decidi autonomamente se creare da zero, modificare, usare template',
      '📋 Rispetta SEMPRE le PROJECT RULES (apprese dal progetto) — link style, form endpoints, CSS approach',
      '🔄 Quality feedback loop: il sistema auto-corregge problemi critici (H1, links, forms) — max 1 retry',
      '📐 Se utente fornisce URL ispirazione + screenshot: analizza visual design, colori, layout',
      '📦 Se template disponibile: usalo come base (riempi {{placeholder}}) oppure crea da zero',
      '✅ Per modifiche: usa typed_edits (rapido) oppure edit_page ops (strutturale)',
      '🏗️ Per creazione: genera design system completo (CSS vars, tipografia, palette)',
      '📱 Mobile-first: viewport, responsive flexbox/grid',
    ],
  },
  {
    name: 'seo',
    displayName: 'SEO Agent',
    description: 'Genera sitemap.xml, robots.txt, ottimizza meta tags, Open Graph, canonical URLs.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    category: 'modifier',
    inputs: ['messages', 'pages', 'custom domain', 'context'],
    outputs: ['seo files + page edits'],
    systemPromptPreview: 'Ottimizza l\'aspetto SEO del sito: meta, sitemap, robots, schema.org, OG tags.',
    filePath: 'lib/agents/seo-agent.ts',
    enabled: true,
    rules: [
      'Agisce solo su richiesta esplicita SEO (non gira automaticamente nel pipeline base)',
      'Ottimizza: <title>, <meta description>, Open Graph, Twitter Card, canonical',
      'Genera sitemap.xml con tutte le pagine del sito',
      'Genera robots.txt con regole base',
      'Non modifica il layout o i testi visibili, solo i meta tag',
    ],
  },
  {
    name: 'design-update',
    displayName: 'Design Update Agent',
    description: 'Modifica solo aspetti di design (colori, font, tema) lasciando i contenuti invariati.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    category: 'modifier',
    inputs: ['user request', 'pages attuali', 'context'],
    outputs: ['pages con design aggiornato'],
    systemPromptPreview: 'Cambia esclusivamente CSS/colori/tipografia senza modificare il testo del sito.',
    filePath: 'lib/agents/design-agent.ts',
    enabled: true,
    rules: [
      'Modifica SOLO CSS: colori, font, spaziatura, bordi, ombre',
      'Non tocca mai il testo visibile (h1, paragrafi, CTA label)',
      'Non aggiunge o rimuove sezioni o elementi HTML',
      'Usa find/replace per aggiornare solo le proprietà CSS cambiate',
    ],
  },
  {
    name: 'content-update',
    displayName: 'Content Update Agent',
    description: 'Riscrive i testi con tone of voice diverso o traduce, mantenendo il design invariato.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    category: 'modifier',
    inputs: ['user request', 'pages attuali', 'context'],
    outputs: ['pages con testi aggiornati'],
    systemPromptPreview: 'Modifica solo i testi delle pagine secondo le istruzioni utente (tone, traduzione).',
    filePath: 'lib/agents/content-agent.ts',
    enabled: true,
    rules: [
      'Modifica SOLO i testi: headings, paragrafi, label CTA, alt text',
      'Non tocca mai CSS, classi, o struttura HTML',
      'Mantiene la stessa struttura semantica (h1 resta h1, ecc.)',
      'Può tradurre in un\'altra lingua se richiesto',
    ],
  },
  {
    name: 'site-analyzer',
    displayName: 'Site Analyzer',
    description: 'Analizza siti di ispirazione: estrae HTML/CSS da un URL (Round 1) e analizza gli screenshot caricati dall\'utente con Claude Vision (Round 2) per produrre un DesignBrief completo.',
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 2048,
    category: 'utility',
    inputs: ['URL', 'screenshot URLs (base64)'],
    outputs: ['DesignBrief (colors, fonts, style, spacing)'],
    systemPromptPreview: 'Visita un sito esterno (HTML/CSS) e/o analizza screenshot via Claude Vision. Produce un brief sintetico (palette, tipografia, layout) usabile come ispirazione.',
    filePath: 'lib/agents/site-analyzer.ts',
    enabled: true,
    rules: [
      'Round 1: fetch HTML del sito, estrae CSS inline + variabili custom (--primary, --font-*)',
      'Round 2: scarica gli screenshot caricati dall\'utente (max 4MB, jpeg/png/gif/webp) e li invia a Claude Vision',
      'Output: DesignBrief con colori HEX, font Google, border-radius, spacing, note di stile',
      'Non genera HTML, solo il brief — passa il risultato al Template Generator',
      'Se il fetch URL fallisce, prosegue solo con i screenshot (e viceversa)',
    ],
  },
  {
    name: 'template-generator',
    displayName: 'Template Generator',
    description: 'Genera un template HTML completo (con placeholder {{key}}) a partire dal DesignBrief estratto dal Site Analyzer. Usato nel flusso "ispirazione URL + screenshot".',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 16384,
    category: 'utility',
    inputs: ['DesignBrief', 'user request'],
    outputs: ['GeneratedTemplate (name, sector, 1 keyword EN, html)'],
    systemPromptPreview: 'Genera un template HTML professionale (~400 righe) che rispetta esattamente il design brief: colori, font, border-radius. Usa placeholder {{key}} per tutti i testi.',
    filePath: 'lib/agents/template-generator.ts',
    enabled: true,
    rules: [
      'Usa SEMPRE i colori e font del DesignBrief — mai inventare',
      'Tutti i testi sono placeholder {{key}} (mai testi fissi)',
      'Output min 400 righe: head + meta SEO, nav responsive, hero, features (3-4), CTA, footer',
      'Genera ESATTAMENTE 1 keyword in inglese (es: "hotel", "restaurant", "clinic")',
      'Il template generato viene salvato nella tabella templates di Supabase',
      'Nessuna dipendenza esterna eccetto Google Fonts e SVG inline',
    ],
  },
  {
    name: 'images',
    displayName: 'Images Agent',
    description: 'Ottimizza il markup delle immagini: alt text descrittivi, loading=lazy, srcset.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    category: 'utility',
    inputs: ['page html', 'business type'],
    outputs: ['edits find/replace per img'],
    systemPromptPreview: 'Migliora <img> aggiungendo alt SEO, loading=lazy, width/height. Non modificare src.',
    filePath: 'lib/agents/images-agent.ts',
    enabled: true,
    rules: [
      'Non modifica mai l\'attributo src delle immagini',
      'Aggiunge alt text descrittivo e SEO-friendly se mancante',
      'Aggiunge loading="lazy" a tutte le immagini non above-the-fold',
      'Aggiunge width e height se assenti (per prevenire layout shift)',
    ],
  },
  {
    name: 'accessibility',
    displayName: 'Accessibility Agent',
    description: 'Audit e correzioni accessibilità (WCAG): aria-labels, contrasto, struttura semantica.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    category: 'utility',
    inputs: ['page html'],
    outputs: ['edits per accessibility fixes'],
    systemPromptPreview: 'Audit WCAG: aggiungi aria-*, fix headings, contrasto, struttura semantica.',
    filePath: 'lib/agents/accessibility-agent.ts',
    enabled: true,
    rules: [
      'Standard di riferimento: WCAG 2.1 livello AA',
      'Controlla: gerarchia heading (h1→h2→h3), aria-label su bottoni, alt su immagini',
      'Aggiunge aria-*, role, tabindex dove necessario',
      'Non modifica il contenuto visibile o il layout',
    ],
  },
]

export const PIPELINE_FLOW = [
  { id: 'clarifier', label: 'Clarifier', column: 0, row: 0 },
  { id: 'memory', label: 'Memory', column: 1, row: 0 },
  { id: 'planner', label: 'Planner', column: 2, row: 0 },
  { id: 'site-analyzer', label: 'Site Analyzer\n(se URL)', column: 2, row: 1, optional: true },
  { id: 'content', label: 'Content', column: 3, row: 0 },
  { id: 'design', label: 'Design', column: 3, row: 1 },
  { id: 'html', label: 'HTML', column: 4, row: 0 },
] as const

export const PIPELINE_EDGES = [
  { from: 'clarifier', to: 'memory' },
  { from: 'memory', to: 'planner' },
  { from: 'planner', to: 'content' },
  { from: 'planner', to: 'design' },
  { from: 'site-analyzer', to: 'design' },
  { from: 'content', to: 'html' },
  { from: 'design', to: 'html' },
] as const
