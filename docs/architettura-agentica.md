# Architettura Agentica — Documento di Sintesi

> Stato: giugno 2025  
> Confronto: architettura precedente (multi-agent pipeline) vs attuale (master agent)

---

## Prima — Pipeline Multi-Agente

```
user message
     ↓
  clarifier          ← chiede chiarimenti se ambiguo
     ↓
  classify()         ← LLM call: pipeline / html / seo / design-update / content-update
     ↓
  ┌──────────────────────────────────┐
  │  IF pipeline:                    │
  │  planner → content → design → html │
  │                                  │
  │  IF html:   html-agent           │
  │  IF seo:    seo-agent            │
  │  IF design: design-update-agent  │
  │  IF content: content-update-agent│
  └──────────────────────────────────┘
```

**Componenti attivi**: 8+ agenti specializzati  
**API calls per richiesta**: 2–6 (classificazione + agente specifico + eventuali sub-agenti)  
**Contesto pagina attiva**: skeleton HTML (troncato, ~30% dell'originale)  
**Messaggi passati al modello**: slice(-6) = ultimi 3 exchange  
**Modello per create_site**: Haiku 4.5  
**Max tokens**: 16.384 fisso su tutti i task  
**Quality check**: nessuno  
**Memoria design**: nessuna (ogni turno riparte da zero)  
**Design System**: unidirezionale (platform → agent)

---

## Dopo — Master Agent

```
user message
     ↓
  HTML Agent (Sonnet 4.6)
  ├── contesto: full HTML + session memory + project rules + design system
  ├── modello: Haiku (micro-edit) | Sonnet (tutto il resto)
  ├── extended thinking 8k: solo su primo sito da zero
  ├── output: create_site / edit_page / add_page / delete_page
     ↓
  Quality Loop (server-side)
  ├── ricostruisce HTML finale
  ├── verifica: H1, links, forms, Tailwind, immagini...
  └── se critical issues → 1 retry automatico con feedback
     ↓
  Background (non-blocking, parallelo)
  ├── Memory Agent → aggiorna business context
  ├── Session Memory Agent → aggiorna design diary
  └── Rules Learner → aggiorna project rules
     ↓
  Design System Sync
  └── se create_site → estrae palette/tipografia → popola DS panel
```

**Componenti attivi**: 3 (HTML Agent + Memory Agent + SEO Agent)  
**API calls per richiesta**: 1 (+ 2 background non-blocking)  
**Contesto pagina attiva**: full HTML completo  
**Messaggi passati al modello**: slice(-6) + session memory (~600 tok)  
**Modello per create_site**: Sonnet 4.6 + extended thinking  
**Max tokens**: 4k–64k adattivi per tipo task  
**Quality check**: server-side, auto-correzione su critical issues  
**Memoria design**: session memory MD, persiste tra sessioni  
**Design System**: bidirezionale (platform ↔ agent)

---

## Tabella Confronto

| Dimensione | Prima | Dopo | Δ |
|---|---|---|---|
| Agenti attivi | 8+ | 3 | −62% |
| API calls/request | 2–6 | 1 | −80% |
| Modello create_site | Haiku 4.5 | Sonnet 4.6 | +++ qualità |
| Extended thinking | No | Sì (primo sito) | ++ ragionamento |
| Design principles | No | Sì (in prompt) | ++ identità visiva |
| Contesto HTML | Skeleton (~30%) | Full HTML (100%) | +++ precisione edit |
| Memoria conversazione | Ultimi 6 msg | 6 msg + session memory | ++ contesto lungo |
| Memoria tra sessioni | Context JSON | Context + Session MD | ++ continuità |
| Project rules | Hardcoded | Apprese dal progetto | ++ adattività |
| Quality check | No | Server-side + retry | ++ correttezza |
| DS sync | Platform → Agent | Bidirezionale | ++ coerenza visiva |
| Max tokens | 16k fisso | 4k–64k adattivi | ++ efficienza |
| Latency micro-edit | Dipende da routing | ~2s (Haiku diretto) | ++ |
| Latency create_site | ~8s (pipeline) | ~12s (thinking incluso) | − accettabile |

---

## I 7 Interventi Implementati

### 1 — Full HTML Context
**File**: `lib/agents/html-agent.ts`  
**Cosa**: la pagina attiva viene passata con HTML completo invece dello skeleton troncato.  
**Perché**: gli skeleton troncavano class names e testi, causando ~20% di fallimenti su find/replace.

### 2 — Quality Feedback Loop
**File**: `lib/agents/html-quality.ts` + `app/api/chat/route.ts`  
**Cosa**: dopo ogni `edit_page`/`create_site`, il server ricostruisce l'HTML finale e verifica:
- Critical (blocca + retry): H1 count ≠ 1, elementi block in `<p>`, classi Tailwind, link assoluti, form senza `/api/forms`
- Warning (advisory): immagini senza alt, script senza defer, font senza `display=swap`

Se critical issues → 1 retry automatico con feedback all'agente.

### 3 — Project-Specific Rules
**File**: `lib/agents/project-rules.ts` + `lib/agents/rules-learner.ts`  
**Cosa**: il sistema analizza le pagine esistenti e impara automaticamente le convenzioni del progetto:
- Stile link (`./slug` vs `/slug`)
- Endpoint form (`/api/forms`)
- Approccio CSS (Tailwind vs custom)
- Toggle menu mobile (`open` vs `active`)
- Struttura blog (separato vs in site_config)

Le regole vengono salvate in `site_config.projectRules` e passate all'agente ad ogni turno. Confidence level incluso per ogni regola appresa.

### 4 — Session Memory
**File**: `lib/agents/memory-agent.ts` (funzione `runSessionMemoryAgent`)  
**Cosa**: documento markdown aggiornato in background dopo ogni turno. Cattura:
- Decisioni di design prese (palette, font, stile)
- Correzioni ricevute dall'utente
- Struttura sito (pagine create ✅, in corso, da fare)
- Vincoli negativi ("no carousel", "no popup")
- Riferimenti visivi ("stile Linear.app")

~600 token fissi. Sostituisce 15k+ token di messaggi raw. Persiste tra sessioni diverse.

### 5 — Eliminazione Pipeline
**File**: `app/api/chat/route.ts`  
**Cosa**: rimossi clarifier, planner, content-agent, design-agent come agenti separati. L'HTML Agent decide autonomamente cosa fare (create_site / edit_page / add_page).  
**Perché**: la pipeline multi-stage aggiungeva latenza e overhead di contesto senza benefici proporzionali. Sonnet 4.6 ha capacità di reasoning sufficiente per fare pianificazione, design e generazione in un singolo pass.

### 6 — Bidirectional Design System Sync
**File**: `lib/agents/design-extractor.ts` + `app/api/chat/route.ts`  
**Cosa**:
- **Agent → Platform**: dopo `create_site`, estrae tipografia e CSS vars dall'HTML generato e popola automaticamente `siteConfig.designSystem` + `shared_css`. Il pannello DS nella UI si auto-popola.
- **Platform → Agent**: quando l'utente modifica il DS nel pannello, i valori vengono marcati come "AUTORITATIVI" nel prompt. L'agente non li sovrascrive mai.

### 7 — Design Quality (Sonnet + Extended Thinking + Design Principles)
**File**: `lib/agents/html-agent.ts`  
**Cosa**: tre layer che insieme chiudono il gap qualitativo con Claude in chat:

**a) Model selection adattiva**
```
Micro-edit → Haiku 4.5   (veloce, economico)
Tutto il resto → Sonnet 4.6   (qualità creativa)
```
Prima: Haiku per TUTTI i task incluso create_site.

**b) Extended Thinking (solo primo sito)**
8.000 token di thinking dove il modello ragiona prima di generare:
`business type → visual language → palette → typography → layout`  
Attivato solo su `!hasPages` (primo sito da zero). Costo: ~$0.024/sito.

**c) Design principles nel system prompt**
Mapping business type → palette + font pairing + regole di spazio/gerarchia. Iniettato solo su `create_site` e `add_page`.

---

## Adaptive Max Tokens

| Task | Budget | Output atteso |
|---|---|---|
| micro-edit | 4k | 200–800 tok |
| edit_page standard | 12k | 2–6k tok |
| add_page | 24k | 6–12k tok |
| vision / mockup | 32k | analisi + HTML |
| create_site ≤3 pagine | 32k | 10–20k tok |
| create_site 4–6 pagine | 48k | 20–35k tok |
| primo sito (0 pagine) | 64k | libero |

---

## Pro

### Qualità output
- **Primo sito**: Sonnet + extended thinking → identità visiva coerente al business, non palette generica
- **Edit precision**: full HTML → zero fallimenti per class name troncato
- **Auto-correzione**: quality loop blocca H1 multipli, Tailwind, link sbagliati prima che arrivino al client
- **Consistenza**: project rules learned + DS bidirezionale → ogni nuova pagina è coerente con le precedenti

### Efficienza
- **1 API call** invece di 2–6 per pipeline
- **Haiku su micro-edit**: delete/CSS var/testo in ~2s con costo minimo
- **Token adattativi**: micro-edit non paga il costo di create_site
- **Session memory**: 600 token fissi invece di 15k+ di messaggi raw

### Adattività
- **Self-learning**: il sistema impara le convenzioni del progetto senza configurazione manuale
- **Session continuity**: le decisioni di design persistono tra sessioni diverse
- **DS auto-popolato**: l'utente non deve inserire manualmente tipografia e colori

---

## Contro

### Costo su create_site
Sonnet 4.6 + extended thinking su primo sito = ~3–5x il costo di Haiku.  
Mitigazione: accade una volta per sito. Su micro-edit (80% dei turni) il costo è invariato o inferiore (Haiku).

### Latenza create_site
~12–15s con thinking vs ~5–8s precedenti.  
Mitigazione: giustificato dalla qualità. L'utente aspetta comunque la generazione. Mostrare "⚙️ Ragionando sul design..." nel progress.

### Single point of failure
Prima: se l'agente HTML falliva, solo le modifiche puntuali erano bloccate.  
Ora: se l'HTML Agent è giù, l'intero sistema si ferma.  
Mitigazione: il back office può disabilitare l'agente e mostrare un messaggio chiaro.

### Quality loop add latenza
Il check HTML aggiunge ~100-200ms per ogni `edit_page`/`create_site`.  
Mitigazione: trascurabile. Il valore della correzione automatica supera il costo.

### Skill SEO non integrate nel master
Il SEO Agent esiste ancora come agente separato e viene chiamato solo su richiesta esplicita. Non c'è un trigger automatico dopo la creazione del sito.  
Gap aperto: dovrebbe essere chiamato in background dopo ogni `create_site`.

---

## File Principali

| File | Ruolo |
|---|---|
| `app/api/chat/route.ts` | Entry point, orchestrazione, background agents |
| `lib/agents/html-agent.ts` | Master agent (modello, thinking, tools, prompt) |
| `lib/agents/html-quality.ts` | Quality checker + apply server-side |
| `lib/agents/project-rules.ts` | Struttura regole + utilità |
| `lib/agents/rules-learner.ts` | Estrazione automatica convenzioni |
| `lib/agents/memory-agent.ts` | Context agent + Session Memory agent |
| `lib/agents/design-extractor.ts` | Estrazione DS da HTML + merge in shared_css |
| `lib/agents/config.ts` | Modelli e max_tokens per agente |
| `lib/agents/manifest.ts` | Documentazione agenti (back office) |

---

## Gap Ancora Aperti

| Gap | Impatto | Complessità |
|---|---|---|
| SEO auto-trigger dopo create_site | Medio | Bassa |
| Screenshot feedback (Playwright) | Alto | Alta |
| Template injection su create_site | Alto | Media |
| Extended thinking su add_page "redesign" | Medio | Bassa |
| Quality loop su blog posts (generate-blog-post) | Medio | Bassa |

---

*Generato automaticamente — ultima modifica: giugno 2025*
