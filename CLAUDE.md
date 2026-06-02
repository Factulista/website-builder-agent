# Factulista — Website Builder Agent

SaaS che permette agli utenti di generare siti web completi tramite AI (pipeline multi-agente Claude), con CMS blog, dominio personalizzato e preview live.

---

## Stack

- **Framework**: Next.js 14 App Router (TypeScript)
- **Database + Auth + Storage**: Supabase
- **AI**: Anthropic Claude (Haiku 4.5 di default, configurabile via back-office)
- **Deploy**: Vercel
- **DNS custom domain**: Cloudflare API

---

## Variabili d'ambiente richieste

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
VERCEL_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
```

---

## Struttura cartelle chiave

```
app/
  api/
    chat/route.ts          ← Endpoint principale: riceve messaggi utente, esegue il pipeline AI
    blog-posts/            ← CRUD post blog
    publish-project/       ← Pubblica sito (genera slug, aggiorna DB)
    add-custom-domain/     ← Integrazione Vercel + Cloudflare per domini custom
    seo-fix/route.ts       ← Esegue SEO agent su richiesta
    generate-blog-post/    ← Genera articolo blog con AI
  projects/[id]/page.tsx   ← Editor principale (pagina più grande, ~3600 righe)
  preview/[slug]/          ← Serve preview del sito generato (route handler HTML)
    blog/route.ts          ← Lista articoli blog in preview
    blog/[postSlug]/       ← Singolo articolo in preview
  back-office/             ← Admin panel (agenti, run log, template, settings)

lib/
  agents/
    orchestrator.ts        ← Classifica intent utente e coordina il pipeline
    planner.ts             ← Pianifica struttura pagine
    content-agent.ts       ← Genera testi e copy
    design-agent.ts        ← Genera palette, font, CSS
    html-agent.ts          ← Genera/modifica HTML; runHtmlAgentFromTemplate() per template
    seo-agent.ts           ← Ottimizza meta tag; runBlogSeoAgent() per articoli blog
    images-agent.ts        ← Ottimizza alt text e immagini
    accessibility-agent.ts ← Controlla WCAG 2.1 AA
    memory-agent.ts        ← Aggiorna context del progetto
    config.ts              ← AGENT_CONFIGS (model, maxTokens per agente) + callClaude()
  templates/
    index.ts               ← Registry template, detectTemplate(), applyPlaceholders()
    saas.ts                ← Template dark tech/software generico (~95 placeholder)
    saas2.ts               ← Template light fatturazione/contabilità (~92 placeholder)
  blog-serve.ts            ← buildBlogListPage() e buildBlogPostPage() condivisi
  types.ts                 ← Tipo Page { slug, name, html, menuLabel, inMenu }
  seo/                     ← Analizzatore SEO client-side (checks, groups, scorer)

components/
  EditorSidebar.tsx        ← Sidebar sinistra dell'editor
  HtmlCodeEditor.tsx       ← Editor codice HTML (CodeMirror)
  Sidebar.tsx              ← Sidebar navigazione progetti
```

---

## Pipeline AI (flusso principale)

Ogni messaggio utente in chat passa per `app/api/chat/route.ts`:

```
1. Orchestrator   → classifica intent (genera sito / modifica pagina / SEO / blog / altro)
2. Planner        → decide struttura pagine, template da usare
3. Content agent  → genera testi per ogni sezione
4. Design agent   → palette colori, font, stile CSS
5. HTML agent     → assembla HTML finale
   └─ se template → extractPlaceholderKeys() → batch Claude calls → applyPlaceholders()
6. SEO agent      → meta title/description per ogni pagina + articoli blog
7. Images agent   → ottimizza attributi immagini
8. Accessibility  → fix WCAG
9. Memory agent   → aggiorna context progetto in DB
```

I risultati vengono streamati al client via SSE (Server-Sent Events).

---

## Template system

I template hanno placeholder `{{key}}` (es. `{{hero_title}}`).  
**Non** vengono mai inviati al modello AI completi — troppo grandi (50-60KB).  
Flusso:
1. `extractPlaceholderKeys(html)` estrae la lista chiavi
2. Le chiavi vengono mandate in batch da 30 a Claude (tool `fill_placeholders`)
3. Claude restituisce solo i valori JSON
4. `applyPlaceholders(html, values)` riempie il template server-side

---

## Dominio preview

I siti generati sono raggiungibili su `myweb.factulista.com/{slug}`.  
La route `/preview/[slug]` serve l'HTML del sito.  
Con dominio custom: `https://{customDomain}` → `app/api/serve-custom-domain/route.ts`.

---

## Convenzioni

- **Lingua UI**: italiano (label, toast, errori)
- **Lingua sito generato**: rilevata da `context.language` → `<html lang="...">` → default `'it'`
- **Stile**: tutto inline (no CSS modules, no Tailwind) — i componenti usano oggetti `style={{}}`
- **Colori editor**: costante `C` in `page.tsx` (es. `C.blue`, `C.border`, `C.textFaint`)
- **Agent model default**: `claude-haiku-4-5-20251001` — modificabile dal back-office senza deploy
- **TypeScript strict**: sempre fare `npx tsc --noEmit` prima di committare

---

## Comandi utili

```bash
npm run dev          # avvia in locale (porta 3000)
npx tsc --noEmit     # check TypeScript senza compilare
```

---

## Workflow git (team)

- Usare **branch per feature**: `feat/nome-feature`
- Non pushare direttamente su `main` se si lavora in contemporanea
- Fare `git pull` prima di iniziare una sessione di lavoro
- File più soggetto a conflitti: `app/projects/[id]/page.tsx` (~3600 righe)

---

## Session Management (Claude Code)

To keep context window efficient across sessions:

1. **Start session**: Read `.claude/session-state.json` first (2k tokens)
2. **Work normally**: Use memory files only if needed
3. **End session** (when context > 50%):
   - Update `.claude/session-state.json` with:
     - `lastCommit` hash
     - `activeTask` (null if done)
     - `nextSteps` (list of immediate TODOs)
     - `blockers` (any blockers preventing progress)
   - `git add .claude/ && git commit -m "chore: update session state" && git push`

**File structure:**
```
.claude/
  session-state.json     ← Read first, current status
  projects/.../
    memory/
      state.jsonl        ← JSONL compact state (agents, bugs fixed, config)
      MEMORY.md          ← Index only
      [other].md         ← Detailed docs (read only if needed)
```

**Token budget:**
- session-state.json: ~2k
- state.jsonl: ~3k
- Total overhead per session: 5k (vs 92k before)
