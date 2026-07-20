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
    description: '[Background, sempre attivo] Due agenti paralleli: (1) Context Agent — estrae businessName, tono, settore. (2) Session Memory — diario markdown decisioni di design, correzioni, vincoli. Compaction automatica su sessioni >40 messaggi.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    category: 'background',
    inputs: ['ultimi 10 messaggi', 'contesto JSON esistente', 'session memory markdown'],
    outputs: ['ProjectContext aggiornato', 'diario sessione aggiornato'],
    systemPromptPreview: 'Estrai informazioni chiave sul progetto e aggiorna contesto + diario. Compaction automatica quando diario > 2000 caratteri.',
    filePath: 'lib/agents/memory-agent.ts',
    enabled: true,
    rules: [
      'Gira in background dopo ogni risposta — non blocca la pipeline principale',
      'Context Agent estrae: businessName, businessType, targetAudience, language, tone',
      'Session Memory mantiene: decisioni design, correzioni ricevute, vincoli negativi, struttura sito',
      'Compaction automatica (Haiku, 1k tok) quando session memory > 2000 chars e conversazione > 40 msg',
      'Output usato come cache L2 nel system prompt (semi-static, cache_control ephemeral)',
    ],
  },
  {
    name: 'html',
    displayName: 'Master HTML Agent',
    description: '[Sempre attivo — pipeline principale] Unico agente che risponde in chat, gestisce TUTTO via tool use. Crea siti, modifica blocchi, aggiorna design, fa audit SEO, aggiunge pagine. Routing adattivo: Haiku su edit_block (blocco già isolato, ~6k tok), Sonnet su create_site/replace_block/vision.',
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    category: 'orchestration',
    inputs: [
      'messaggio utente',
      'block index pagina attiva (~50 tok) + blocco pre-caricato (~5k tok)',
      'blocchi visibili in viewport (IntersectionObserver, automatico)',
      'click utente sulla preview (selector + anchor text)',
      'project context + session memory + project rules',
      'media library',
    ],
    outputs: [
      'create_site — crea sito multi-pagina',
      'edit_page — modifica pagina intera (fallback monolite)',
      'add_page / delete_page',
      'read_block / edit_block / replace_block — editing block-scoped',
      'run_seo_audit — audit SEO deterministico + fix opzionali',
      'update_design — aggiorna CSS globale / design system',
      'insert_component — inietta componenti da libreria',
      'set_inject_point — script/embed/widget personalizzati',
      'search_html / read_page / read_block — ispezione sola lettura',
    ],
    systemPromptPreview: 'Agente master con tool use. Fase 1: legge block index, sceglie blocco target, usa read_block → edit_block. Fase 4: decide autonomamente se serve SEO audit, design update, o edit HTML.',
    filePath: 'lib/agents/html-agent.ts',
    enabled: true,
    rules: [
      '🏗️ BLOCK MODE (Fase 1): pagine con ≥3 blocchi → riceve block index (50 tok) + blocco pre-caricato. Usa read_block → edit_block/replace_block. Mai full-page su edit.',
      '👁️ VIEWPORT CONTEXT (Fase 2): IntersectionObserver invia automaticamente i blocchi visibili. Nessuna azione utente richiesta.',
      '🎯 CLICK PRIORITY: se utente ha cliccato un elemento nella preview → quel blocco ha priorità assoluta.',
      '🤖 MODEL ROUTING (Fase 3a): edit_block + pageHasBlocks → Haiku (6k max_tokens). create_site/replace_block/vision → Sonnet.',
      '💾 CACHE 3-LEVEL (Fase 3b): L1 static (tools+guardrails), L2 semi-static (design system+rules), L3 dynamic (block index, non cacheable).',
      '🔍 INSPECTION LOOP: read_block è tool di ispezione — il loop continua dopo la lettura. Max 4 inspection steps poi azione.',
      '📊 SEO TOOL (Fase 4): run_seo_audit usa seo-compiler deterministico (14 check). applyFixes=true corregge automaticamente.',
      '🎨 DESIGN TOOL (Fase 4): update_design delega a design-agent per CSS o applica CSS diretto via _shared_css.',
      '✅ QUALITY LOOP: dopo edit_page/create_site → check H1/links/forms → max 1 retry automatico.',
    ],
  },
  {
    name: 'design-update',
    displayName: 'Design Agent (tool)',
    description: '[On-demand — chiamato dal tool update_design] Non è mai routato direttamente: il Master Agent lo invoca solo quando l\'utente chiede di cambiare colori/font/tema globale. Aggiorna il CSS condiviso del sito.',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    category: 'utility',
    inputs: ['changes description', 'current shared_css'],
    outputs: ['nuovo shared_css'],
    systemPromptPreview: 'Legacy. Ora chiamato solo da update_design tool nel Master HTML Agent quando l\'utente chiede cambio colori/font/tema globale.',
    filePath: 'lib/agents/design-agent.ts',
    enabled: true,
    rules: [
      '⚠️ Non viene più routato direttamente dal route — agente master decide quando chiamarlo',
      'Il tool update_design può passare CSS diretto (_shared_css) senza delegare a questo agente',
      'Modifica SOLO shared_css (variabili :root, font imports) — non tocca HTML pagine',
      'Output: nuovo CSS mergato in tutte le pagine + salvato in site_config.shared_css',
    ],
  },
  {
    name: 'site-analyzer',
    displayName: 'Site Analyzer',
    description: '[Feature separata — import da URL] Non fa parte della chat/build principale. Analizza siti di ispirazione: estrae HTML/CSS da un URL (Round 1) e screenshot via Claude Vision (Round 2) per produrre un DesignBrief.',
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
    description: '[Feature separata — import da URL] Non fa parte della chat/build principale. Genera un template HTML completo (con placeholder {{key}}) a partire dal DesignBrief estratto dal Site Analyzer.',
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
    name: 'blog-post',
    displayName: 'Blog Post Generator',
    description: '[Feature separata — pannello Blog] Non fa parte della chat/build principale. Genera articoli di blog completi (SEO + GEO) in streaming a partire da topic/keyword, con tono di voce preso dagli ultimi articoli pubblicati.',
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    category: 'utility',
    inputs: ['topic', 'keyword primaria/secondarie', 'parametri struttura (parole, H2/H3/H4, flags)', 'tono di voce (ultimi 3 articoli pubblicati)', 'fonti URL opzionali', 'design system tipografico'],
    outputs: ['metadati JSON (title, slug, seo_title, seo_description, excerpt)', 'HTML articolo completo (streaming)'],
    systemPromptPreview: 'Copywriter/SEO/GEO specialist. Scrive HTML semantico puro (zero style inline), struttura in due blocchi (metadati JSON + delimitatore + HTML grezzo).',
    filePath: 'app/api/generate-blog-post/route.ts',
    enabled: true,
    rules: [
      'Streaming SSE diretto via fetch a api.anthropic.com — non passa dal Master HTML Agent',
      'Output in due blocchi: JSON metadati poi ===CONTENT_HTML=== poi HTML grezzo (evita fragilità escape-quote su articoli lunghi)',
      'HTML semantico puro: zero style="", zero attributi color/font/size — il Design System della piattaforma gestisce lo stile',
      'Consuma crediti in base ai token reali (input+output) a fine generazione',
      'Tono di voce: legge gli ultimi 3 articoli pubblicati del progetto per replicare stile/registro',
    ],
  },
]

// Fase 4: single-agent architecture — no orchestrator, no classifier
// Route → Master HTML Agent (with tool use) ← Memory (background, parallel)
export const PIPELINE_FLOW = [
  { id: 'preview-context', label: 'Preview Context\n(viewport/click)', column: 0, row: 1, optional: true },
  { id: 'memory', label: 'Memory\n(background)', column: 0, row: 0 },
  { id: 'html', label: 'Master HTML Agent', column: 1, row: 0 },
  { id: 'block-splitter', label: 'Block Splitter\n(se blocchi presenti)', column: 2, row: 1, optional: true },
  { id: 'seo-compiler', label: 'SEO Compiler\n(su publish)', column: 2, row: 2, optional: true },
  { id: 'design-agent', label: 'Design Agent\n(via update_design tool)', column: 2, row: 0, optional: true },
] as const

export const PIPELINE_EDGES = [
  { from: 'memory', to: 'html' },
  { from: 'preview-context', to: 'html' },
  { from: 'html', to: 'block-splitter' },
  { from: 'html', to: 'design-agent' },
  { from: 'html', to: 'seo-compiler' },
] as const
