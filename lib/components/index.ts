export type Component = {
  id: string
  name: string
  description: string
  category: 'form' | 'social-proof' | 'content' | 'utility' | 'navigation'
  tags: string[]
  /** Static preview HTML shown in the Library UI tab (🧩) */
  html: string
  /**
   * Optional parametric renderer. When present, this component can be inserted
   * by the agent via the `insert_component` tool with custom data — saving
   * tokens vs. generating the full HTML from scratch.
   */
  render?: (data: Record<string, unknown>) => string
  /** Inline docs for the agent — describes the shape of `data` for `render`. */
  paramSchema?: string
}

// ── Button smart renderer ─────────────────────────────────────────────────────

function renderButton(data: Record<string, unknown>): string {
  const label    = String(data.label    ?? 'Clicca qui')
  const href     = data.href    ? String(data.href)    : ''
  const variant  = String(data.variant  ?? 'primary')   // primary | secondary | ghost | outline | pill | destructive
  const size     = String(data.size     ?? 'md')        // sm | md | lg
  const icon     = data.icon    ? String(data.icon)    : ''
  const iconPos  = String(data.iconPos  ?? 'right')     // left | right
  const fullWidth = Boolean(data.fullWidth ?? false)
  const id = `btn-${Math.random().toString(36).slice(2, 8)}`

  const padMap: Record<string, string> = {
    sm: '0.45rem 1rem',
    md: '0.75rem 1.6rem',
    lg: '1rem 2.2rem',
  }
  const fontMap: Record<string, string> = {
    sm: '0.82rem',
    md: '1rem',
    lg: '1.1rem',
  }
  const pad  = padMap[size]  ?? padMap.md
  const font = fontMap[size] ?? fontMap.md

  const baseStyle = [
    `display:inline-flex`,
    `align-items:center`,
    `justify-content:center`,
    `gap:0.45em`,
    `padding:${pad}`,
    `font-size:${font}`,
    `font-weight:700`,
    `font-family:inherit`,
    `border-radius:var(--btn-radius,var(--radius,10px))`,
    `cursor:pointer`,
    `text-decoration:none`,
    `border:2px solid transparent`,
    `transition:opacity 0.15s,transform 0.15s,box-shadow 0.15s`,
    `line-height:1.2`,
    fullWidth ? `width:100%` : '',
  ].filter(Boolean).join(';')

  const variantStyles: Record<string, string> = {
    primary:     `background:var(--color-accent,#2563eb);color:#fff;border-color:transparent;`,
    secondary:   `background:transparent;color:var(--color-accent,#2563eb);border-color:var(--color-accent,#2563eb);`,
    ghost:       `background:transparent;color:var(--color-text,#1a1a1a);border-color:transparent;`,
    outline:     `background:transparent;color:var(--color-text,#1a1a1a);border-color:#d1d5db;`,
    pill:        `background:var(--color-accent,#2563eb);color:#fff;border-color:transparent;border-radius:999px;`,
    destructive: `background:#dc2626;color:#fff;border-color:transparent;`,
  }
  const vs = variantStyles[variant] ?? variantStyles.primary

  const content = icon
    ? (iconPos === 'left' ? `${icon} ${label}` : `${label} ${icon}`)
    : label

  const tag = href ? 'a' : 'button'
  const hrefAttr  = href ? ` href="${href}"` : ''
  const typeAttr  = !href ? ` type="button"` : ''

  return `<${tag} id="${id}" class="comp-btn" style="${baseStyle};${vs}"${hrefAttr}${typeAttr}>${content}</${tag}>
<style>
  #${id}:hover{opacity:0.88;transform:translateY(-1px);}
  #${id}:active{transform:translateY(0);opacity:1;}
</style>`
}

// ── New smart component renderers ────────────────────────────────────────────

function renderStatsRow(data: Record<string, unknown>): string {
  const stats = (data.stats as Array<Record<string, unknown>> | undefined) ?? []
  const items = stats.slice(0, 4)

  const itemsHtml = items.map((s, i) => {
    const value = String(s.value ?? '')
    const label = String(s.label ?? '')
    const divider = i < items.length - 1
      ? '<div class="sr-divider" aria-hidden="true"></div>'
      : ''
    return `<div class="sr-item">
      <span class="sr-value">${value}</span>
      <span class="sr-label">${label}</span>
    </div>${divider}`
  }).join('\n    ')

  return `<section class="sr-section">
  <style>
    .sr-section{padding:3.5rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);}
    .sr-inner{max-width:900px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:0;flex-wrap:wrap;}
    .sr-item{display:flex;flex-direction:column;align-items:center;padding:1.5rem 3rem;gap:0.35rem;flex:1;min-width:160px;}
    .sr-value{font-size:2.75rem;font-weight:800;color:var(--color-accent,#2563eb);line-height:1;letter-spacing:-0.02em;}
    .sr-label{font-size:0.9rem;font-weight:500;color:#6b7280;text-align:center;}
    .sr-divider{width:1px;height:60px;background:#e5e7eb;flex-shrink:0;align-self:center;}
    @media(max-width:600px){
      .sr-inner{flex-direction:column;gap:0;}
      .sr-divider{width:60px;height:1px;}
      .sr-item{padding:1.25rem 1.5rem;width:100%;}
    }
  </style>
  <div class="sr-inner">
    ${itemsHtml}
  </div>
</section>`
}

function renderCtaBanner(data: Record<string, unknown>): string {
  const title = String(data.title ?? 'Pronto a iniziare?')
  const subtitle = String(data.subtitle ?? '')
  const buttonText = String(data.buttonText ?? 'Inizia gratis →')
  const buttonHref = String(data.buttonHref ?? '#')

  return `<section class="cb-section">
  <style>
    .cb-section{padding:4rem 1.5rem;background:var(--color-accent,#2563eb);font-family:var(--font-body,system-ui,sans-serif);text-align:center;}
    .cb-inner{max-width:680px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:1rem;}
    .cb-title{font-size:2.2rem;font-weight:800;color:#ffffff;line-height:1.2;margin:0;letter-spacing:-0.02em;}
    .cb-subtitle{font-size:1.05rem;color:rgba(255,255,255,0.85);margin:0;line-height:1.6;}
    .cb-btn{display:inline-block;margin-top:0.5rem;padding:0.85rem 2rem;background:#ffffff;color:var(--color-accent,#2563eb);font-weight:700;font-size:1rem;border-radius:var(--radius,10px);text-decoration:none;border:none;cursor:pointer;transition:opacity 0.15s,transform 0.15s;font-family:inherit;}
    .cb-btn:hover{opacity:0.92;transform:translateY(-1px);}
    @media(max-width:600px){.cb-title{font-size:1.65rem;}}
  </style>
  <div class="cb-inner">
    <h2 class="cb-title">${title}</h2>
    ${subtitle ? `<p class="cb-subtitle">${subtitle}</p>` : ''}
    <a href="${buttonHref}" class="cb-btn">${buttonText}</a>
  </div>
</section>`
}

// ── Smart component renderers ─────────────────────────────────────────────────
// These are functions used by the `insert_component` agent tool. The agent
// passes structured data; the renderer produces final HTML server-side
// (no token cost on output).

function renderNavFeatureDropdown(data: Record<string, unknown>): string {
  const triggerLabel = String(data.triggerLabel ?? 'Funzionalità')
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? []
  const columnsRaw = Number(data.columns ?? 2)
  const columns = columnsRaw >= 1 && columnsRaw <= 4 ? columnsRaw : 2
  const id = `nfd-${Math.random().toString(36).slice(2, 8)}`

  const itemsHtml = items.map(it => {
    const label = String(it.label ?? '')
    const href = String(it.href ?? '#')
    const icon = it.icon ? String(it.icon) : ''
    const badge = it.badge ? String(it.badge) : ''
    const badgeClass = badge.toLowerCase() === 'nuevo' || badge.toLowerCase() === 'new' || badge.toLowerCase() === 'nuovo'
      ? 'comp-nfd-badge-new'
      : 'comp-nfd-badge-top'
    return `<a href="${href}" class="comp-nfd-item">
      ${icon ? `<span class="comp-nfd-icon" aria-hidden="true">${icon}</span>` : '<span class="comp-nfd-icon" aria-hidden="true"></span>'}
      <span class="comp-nfd-label">${label}</span>
      ${badge ? `<span class="comp-nfd-badge ${badgeClass}">${badge}</span>` : ''}
    </a>`
  }).join('\n      ')

  return `<li class="comp-nfd" data-comp="nav-feature-dropdown">
  <style>
    .comp-nfd{position:relative;list-style:none;}
    .comp-nfd-trigger{background:none;border:none;padding:0.5rem 0.75rem;font:inherit;font-weight:500;color:var(--color-text,#1a1a1a);cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-family:inherit;}
    .comp-nfd-trigger::after{content:'';display:inline-block;border:4px solid transparent;border-top-color:currentColor;margin-top:5px;transition:transform .2s;}
    .comp-nfd[data-open="true"] .comp-nfd-trigger::after{transform:rotate(180deg);margin-top:-2px;}
    .comp-nfd-panel{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:1.25rem;box-shadow:0 12px 40px rgba(0,0,0,0.12);display:none;min-width:480px;z-index:100;}
    .comp-nfd[data-open="true"] .comp-nfd-panel{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:0.4rem 1.25rem;}
    .comp-nfd-item{display:flex;align-items:center;gap:0.75rem;padding:0.65rem 0.7rem;border-radius:10px;color:var(--color-text,#1a1a1a);text-decoration:none;transition:background .15s;font-size:0.9rem;}
    .comp-nfd-item:hover{background:#f8fafc;}
    .comp-nfd-icon{width:32px;height:32px;border-radius:8px;background:#eff6ff;display:inline-flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;color:var(--color-accent,#2563eb);}
    .comp-nfd-label{flex:1;font-weight:500;}
    .comp-nfd-badge{font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:99px;text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0;}
    .comp-nfd-badge-top{background:#fef3c7;color:#92400e;}
    .comp-nfd-badge-new{background:#dbeafe;color:#1d4ed8;}
    @media(max-width:640px){
      .comp-nfd-panel{position:fixed;top:auto;bottom:0;left:0;right:0;transform:none;min-width:0;border-radius:14px 14px 0 0;max-height:70vh;overflow-y:auto;}
      .comp-nfd[data-open="true"] .comp-nfd-panel{grid-template-columns:1fr;}
    }
  </style>
  <button type="button" class="comp-nfd-trigger" aria-expanded="false" aria-controls="${id}">${triggerLabel}</button>
  <div class="comp-nfd-panel" id="${id}" role="menu">
      ${itemsHtml}
  </div>
  <script>
    (function(){
      var li=document.currentScript.parentElement;
      var btn=li.querySelector('.comp-nfd-trigger');
      function open(v){li.setAttribute('data-open',v?'true':'false');btn.setAttribute('aria-expanded',v?'true':'false');}
      btn.addEventListener('click',function(e){e.stopPropagation();open(li.getAttribute('data-open')!=='true');});
      li.addEventListener('mouseenter',function(){if(window.matchMedia('(min-width:641px)').matches)open(true);});
      li.addEventListener('mouseleave',function(){if(window.matchMedia('(min-width:641px)').matches)open(false);});
      document.addEventListener('click',function(e){if(!li.contains(e.target))open(false);});
      document.addEventListener('keydown',function(e){if(e.key==='Escape')open(false);});
    })();
  </script>
</li>`
}

function renderFeatureGrid(data: Record<string, unknown>): string {
  const title = String(data.title ?? 'Funzionalità')
  const subtitle = data.subtitle ? String(data.subtitle) : ''
  const items = (data.items as Array<Record<string, unknown>> | undefined) ?? []
  const columnsRaw = Number(data.columns ?? 3)
  const columns = columnsRaw >= 1 && columnsRaw <= 4 ? columnsRaw : 3

  const itemsHtml = items.map(it => {
    const label = String(it.label ?? '')
    const href = it.href ? String(it.href) : ''
    const icon = it.icon ? String(it.icon) : ''
    const description = it.description ? String(it.description) : ''
    const badge = it.badge ? String(it.badge) : ''
    const tag = href ? 'a' : 'div'
    const hrefAttr = href ? ` href="${href}"` : ''
    return `<${tag} class="comp-fg-card"${hrefAttr}>
      ${icon ? `<div class="comp-fg-icon" aria-hidden="true">${icon}</div>` : ''}
      <div class="comp-fg-body">
        <div class="comp-fg-head">
          <h3 class="comp-fg-label">${label}</h3>
          ${badge ? `<span class="comp-fg-badge">${badge}</span>` : ''}
        </div>
        ${description ? `<p class="comp-fg-desc">${description}</p>` : ''}
      </div>
    </${tag}>`
  }).join('\n      ')

  return `<section class="comp-fg-section">
  <style>
    .comp-fg-section{padding:4rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#fff);}
    .comp-fg-inner{max-width:1100px;margin:0 auto;}
    .comp-fg-header{text-align:center;margin-bottom:2.5rem;}
    .comp-fg-header h2{font-size:2rem;font-weight:800;color:var(--color-text,#1a1a1a);margin:0 0 .6rem;}
    .comp-fg-header p{color:#6b7280;font-size:1.05rem;margin:0;}
    .comp-fg-grid{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:1rem;}
    .comp-fg-card{display:flex;align-items:flex-start;gap:0.9rem;padding:1.1rem 1.2rem;border:1px solid #e5e7eb;border-radius:14px;background:#fff;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s,border-color .2s;}
    .comp-fg-card:hover{box-shadow:0 6px 24px rgba(0,0,0,.07);transform:translateY(-2px);border-color:#d1d5db;}
    .comp-fg-icon{width:42px;height:42px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;font-size:1.25rem;flex-shrink:0;color:var(--color-accent,#2563eb);}
    .comp-fg-body{flex:1;min-width:0;}
    .comp-fg-head{display:flex;align-items:center;gap:8px;}
    .comp-fg-label{font-size:1rem;font-weight:600;margin:0;color:var(--color-text,#1a1a1a);}
    .comp-fg-badge{font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:99px;background:#fef3c7;color:#92400e;text-transform:uppercase;letter-spacing:0.04em;}
    .comp-fg-desc{margin:0.3rem 0 0;font-size:0.85rem;color:#6b7280;line-height:1.45;}
    @media(max-width:760px){.comp-fg-grid{grid-template-columns:1fr;}}
  </style>
  <div class="comp-fg-inner">
    <div class="comp-fg-header">
      <h2>${title}</h2>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
    </div>
    <div class="comp-fg-grid">
      ${itemsHtml}
    </div>
  </div>
</section>`
}

export const COMPONENT_REGISTRY: Component[] = [
  {
    id: 'nav-feature-dropdown',
    name: 'Mega-menu Funzionalità (nav)',
    description: 'Dropdown da inserire nella nav: trigger + griglia di funzionalità con icone, badge "TOP"/"NUEVO". Hover su desktop, click su mobile.',
    category: 'navigation',
    tags: ['mega menu', 'mega-menu', 'dropdown', 'navigazione', 'funzionalità', 'features', 'funcionalidades', 'productos', 'sottomenu', 'submenu'],
    paramSchema: `data: {
  triggerLabel: string  // testo del menu nav, es. "Funcionalidades"
  columns?: 1|2|3|4     // colonne nel pannello (default 2)
  items: Array<{
    label: string       // nome della funzionalità
    href: string        // URL della pagina, es. "/facturacion"
    icon?: string       // emoji o singolo carattere, es. "📄"
    badge?: string      // etichetta opzionale: "TOP", "NUEVO", "BETA", ecc.
  }>
}`,
    render: renderNavFeatureDropdown,
    // Preview HTML for the Library UI tab (uses default Italian data)
    html: renderNavFeatureDropdown({
      triggerLabel: 'Funzionalità',
      columns: 2,
      items: [
        { label: 'Fatturazione', href: '/fatturazione', icon: '📄', badge: 'TOP' },
        { label: 'Contabilità', href: '/contabilita', icon: '📊', badge: 'TOP' },
        { label: 'Tesoreria', href: '/tesoreria', icon: '💰' },
        { label: 'Team', href: '/team', icon: '👥' },
        { label: 'Magazzino', href: '/magazzino', icon: '📦' },
        { label: 'CRM', href: '/crm', icon: '❤️' },
      ],
    }),
  },
  {
    id: 'feature-grid',
    name: 'Griglia Funzionalità',
    description: 'Sezione full-width con griglia di cards funzionalità (icona, nome, descrizione, badge). Perfetta per pagine landing e indici.',
    category: 'content',
    tags: ['feature grid', 'griglia funzionalità', 'features', 'cards', 'funcionalidades grid', 'productos grid'],
    paramSchema: `data: {
  title: string         // titolo della sezione
  subtitle?: string     // sottotitolo opzionale
  columns?: 1|2|3|4     // colonne (default 3)
  items: Array<{
    label: string       // nome
    href?: string       // link opzionale (la card diventa <a>)
    icon?: string       // emoji o icona
    description?: string // testo descrittivo breve
    badge?: string      // "TOP", "NUEVO", ecc.
  }>
}`,
    render: renderFeatureGrid,
    html: renderFeatureGrid({
      title: 'Tutte le funzionalità',
      subtitle: 'Tutto ciò che ti serve per gestire la tua attività.',
      columns: 3,
      items: [
        { label: 'Fatturazione', icon: '📄', description: 'Crea fatture elettroniche conformi in pochi secondi.', badge: 'TOP' },
        { label: 'Contabilità', icon: '📊', description: 'Bilanci e prima nota automatizzati.' },
        { label: 'Tesoreria', icon: '💰', description: 'Riconciliazione bancaria e cashflow.' },
        { label: 'Team', icon: '👥', description: 'Buste paga e gestione del personale.' },
        { label: 'Magazzino', icon: '📦', description: 'Inventario multi-deposito in tempo reale.' },
        { label: 'CRM', icon: '❤️', description: 'Lead, clienti e pipeline commerciale.' },
      ],
    }),
  },
  {
    id: 'logo-carousel',
    name: 'Logo Carousel',
    description: 'Striscia di loghi clienti/partner che scorre infinitamente',
    category: 'social-proof',
    tags: ['logo', 'carousel', 'loghi', 'partner', 'clienti', 'brand', 'scorre', 'infinite scroll', 'testimonial loghi'],
    html: `<section class="comp-lc-wrapper" style="overflow:hidden;padding:2rem 0;background:var(--color-bg,#ffffff);border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
  <style>
    .comp-lc-track{display:flex;gap:3rem;align-items:center;animation:comp-lc-scroll 35s linear infinite;width:max-content;}
    .comp-lc-wrapper:hover .comp-lc-track{animation-play-state:paused;}
    @keyframes comp-lc-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .comp-lc-logo{display:flex;align-items:center;justify-content:center;width:120px;height:52px;background:#f3f4f6;border-radius:var(--radius,10px);flex-shrink:0;}
    .comp-lc-logo span{font-size:0.8rem;font-weight:600;color:#9ca3af;font-family:var(--font-body,system-ui,sans-serif);}
  </style>
  <div style="display:flex;overflow:hidden;">
    <div class="comp-lc-track">
      <div class="comp-lc-logo"><span>Logo 1</span></div>
      <div class="comp-lc-logo"><span>Logo 2</span></div>
      <div class="comp-lc-logo"><span>Logo 3</span></div>
      <div class="comp-lc-logo"><span>Logo 4</span></div>
      <div class="comp-lc-logo"><span>Logo 5</span></div>
      <div class="comp-lc-logo"><span>Logo 6</span></div>
    </div>
    <div class="comp-lc-track" aria-hidden="true">
      <div class="comp-lc-logo"><span>Logo 1</span></div>
      <div class="comp-lc-logo"><span>Logo 2</span></div>
      <div class="comp-lc-logo"><span>Logo 3</span></div>
      <div class="comp-lc-logo"><span>Logo 4</span></div>
      <div class="comp-lc-logo"><span>Logo 5</span></div>
      <div class="comp-lc-logo"><span>Logo 6</span></div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'faq-accordion',
    name: 'FAQ Accordion',
    description: 'Sezione domande frequenti con risposte espandibili',
    category: 'content',
    tags: ['faq', 'accordion', 'domande', 'risposte', 'frequenti', 'questions', 'answers'],
    html: `<section class="comp-faq-section" style="max-width:720px;margin:3rem auto;padding:0 1.5rem;font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-faq-section h2{font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:1.5rem;text-align:center;}
    .comp-faq-item{border-bottom:1px solid #e5e7eb;}
    .comp-faq-question{width:100%;background:none;border:none;padding:1.1rem 0;display:flex;justify-content:space-between;align-items:center;font-size:1rem;font-weight:600;color:var(--color-text,#1a1a1a);cursor:pointer;font-family:inherit;text-align:left;gap:1rem;}
    .comp-faq-question:hover{color:var(--color-accent,#2563eb);}
    .comp-faq-icon{flex-shrink:0;font-size:1.25rem;transition:transform 0.25s;color:var(--color-accent,#2563eb);}
    .comp-faq-question[aria-expanded="true"] .comp-faq-icon{transform:rotate(45deg);}
    .comp-faq-answer{max-height:0;overflow:hidden;transition:max-height 0.3s ease;}
    .comp-faq-answer.open{max-height:500px;}
    .comp-faq-answer-inner{padding:0 0 1.1rem;font-size:0.95rem;line-height:1.7;color:#4b5563;}
  </style>
  <h2>Domande Frequenti</h2>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Qual è il tempo di risposta tipico?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Rispondiamo a tutte le richieste entro 24 ore lavorative. Per i clienti premium il tempo di risposta è garantito entro 4 ore.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Come posso cancellare il mio abbonamento?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Puoi cancellare in qualsiasi momento dal pannello di controllo, nella sezione "Abbonamento". Non ci sono penali né costi aggiuntivi.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Offrite una prova gratuita?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Sì, offriamo 14 giorni di prova gratuita senza inserire la carta di credito. Puoi esplorare tutte le funzionalità senza impegno.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>I miei dati sono al sicuro?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Assolutamente sì. Utilizziamo crittografia AES-256 per tutti i dati a riposo e TLS 1.3 per i dati in transito. Siamo conformi al GDPR.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Posso integrare strumenti di terze parti?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Sì, supportiamo oltre 50 integrazioni tra cui Slack, Google Analytics, HubSpot, Zapier e molti altri. Le integrazioni personalizzate sono disponibili nei piani Business e Enterprise.</div>
    </div>
  </div>
  <script>
    (function(){
      document.querySelectorAll('.comp-faq-question').forEach(function(btn){
        btn.addEventListener('click',function(){
          var expanded=this.getAttribute('aria-expanded')==='true';
          this.setAttribute('aria-expanded',expanded?'false':'true');
          var answer=this.nextElementSibling;
          if(answer){answer.classList.toggle('open',!expanded);}
        });
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'contact-form',
    name: 'Form di Contatto',
    description: 'Form con nome, email, messaggio e validazione client-side',
    category: 'form',
    tags: ['form', 'contatto', 'contact', 'email', 'messaggio', 'modulo', 'formulario'],
    html: `<section class="comp-cf-section" style="max-width:560px;margin:3rem auto;padding:0 1.5rem;font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-cf-section h2{font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-cf-section p.comp-cf-sub{color:#6b7280;margin-bottom:2rem;font-size:0.95rem;}
    .comp-cf-group{margin-bottom:1.2rem;}
    .comp-cf-label{display:block;font-size:0.875rem;font-weight:600;color:var(--color-text,#1a1a1a);margin-bottom:0.4rem;}
    .comp-cf-input,.comp-cf-textarea{width:100%;box-sizing:border-box;padding:0.65rem 0.9rem;border:1.5px solid #d1d5db;border-radius:var(--radius,10px);font-size:0.95rem;font-family:inherit;color:var(--color-text,#1a1a1a);background:#fff;transition:border-color 0.15s;outline:none;}
    .comp-cf-input:focus,.comp-cf-textarea:focus{border-color:var(--color-accent,#2563eb);}
    .comp-cf-textarea{resize:vertical;min-height:120px;}
    .comp-cf-error{display:none;color:#ef4444;font-size:0.78rem;margin-top:0.3rem;}
    .comp-cf-btn{width:100%;padding:0.75rem;background:var(--color-accent,#2563eb);color:#fff;border:none;border-radius:var(--radius,10px);font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity 0.15s;}
    .comp-cf-btn:hover{opacity:0.88;}
    .comp-cf-btn:disabled{opacity:0.55;cursor:not-allowed;}
    .comp-cf-status{margin-top:1rem;padding:0.75rem 1rem;border-radius:var(--radius,10px);font-size:0.9rem;display:none;}
    .comp-cf-status.success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;display:block;}
    .comp-cf-status.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;display:block;}
  </style>
  <h2>Contattaci</h2>
  <p class="comp-cf-sub">Compila il modulo e ti risponderemo entro 24 ore.</p>
  <form class="comp-cf-form" novalidate>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-name">Nome *</label>
      <input class="comp-cf-input" type="text" id="comp-cf-name" name="name" placeholder="Il tuo nome" autocomplete="name">
      <span class="comp-cf-error" id="comp-cf-name-err">Inserisci il tuo nome.</span>
    </div>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-email">Email *</label>
      <input class="comp-cf-input" type="email" id="comp-cf-email" name="email" placeholder="tua@email.com" autocomplete="email">
      <span class="comp-cf-error" id="comp-cf-email-err">Inserisci un'email valida.</span>
    </div>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-msg">Messaggio *</label>
      <textarea class="comp-cf-textarea" id="comp-cf-msg" name="message" placeholder="Come possiamo aiutarti?"></textarea>
      <span class="comp-cf-error" id="comp-cf-msg-err">Scrivi un messaggio.</span>
    </div>
    <button class="comp-cf-btn" type="submit">Invia messaggio</button>
    <div class="comp-cf-status" id="comp-cf-status"></div>
  </form>
  <script>
    (function(){
      var form=document.querySelector('.comp-cf-form');
      if(!form)return;
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var name=document.getElementById('comp-cf-name');
        var email=document.getElementById('comp-cf-email');
        var msg=document.getElementById('comp-cf-msg');
        var nameErr=document.getElementById('comp-cf-name-err');
        var emailErr=document.getElementById('comp-cf-email-err');
        var msgErr=document.getElementById('comp-cf-msg-err');
        var status=document.getElementById('comp-cf-status');
        var valid=true;
        nameErr.style.display='none'; emailErr.style.display='none'; msgErr.style.display='none';
        status.className='comp-cf-status'; status.textContent='';
        if(!name.value.trim()){nameErr.style.display='block';valid=false;}
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)){emailErr.style.display='block';valid=false;}
        if(!msg.value.trim()){msgErr.style.display='block';valid=false;}
        if(!valid)return;
        var btn=form.querySelector('.comp-cf-btn');
        btn.disabled=true; btn.textContent='Invio in corso…';
        fetch('/api/forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value,email:email.value,message:msg.value})})
          .then(function(r){return r.ok?r.json():Promise.reject(r.status);})
          .then(function(){status.className='comp-cf-status success';status.textContent='Messaggio inviato! Ti risponderemo presto.';form.reset();})
          .catch(function(){status.className='comp-cf-status error';status.textContent='Errore nell\'invio. Riprova più tardi.';})
          .finally(function(){btn.disabled=false;btn.textContent='Invia messaggio';});
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'newsletter-form',
    name: 'Form Newsletter',
    description: 'Iscrizione newsletter con campo email e CTA',
    category: 'form',
    tags: ['newsletter', 'email', 'iscrizione', 'subscribe', 'mailinglist', 'mailing list'],
    html: `<section class="comp-nf-section" style="padding:3rem 1.5rem;background:var(--color-bg,#f8fafc);font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-nf-inner{max-width:520px;margin:0 auto;text-align:center;}
    .comp-nf-inner h2{font-size:1.6rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-nf-inner p{color:#6b7280;margin-bottom:1.5rem;font-size:0.95rem;}
    .comp-nf-row{display:flex;gap:0.6rem;flex-wrap:wrap;}
    .comp-nf-input{flex:1;min-width:200px;padding:0.7rem 1rem;border:1.5px solid #d1d5db;border-radius:var(--radius,10px);font-size:0.95rem;font-family:inherit;outline:none;transition:border-color 0.15s;}
    .comp-nf-input:focus{border-color:var(--color-accent,#2563eb);}
    .comp-nf-btn{padding:0.7rem 1.4rem;background:var(--color-accent,#2563eb);color:#fff;border:none;border-radius:var(--radius,10px);font-weight:600;font-size:0.95rem;cursor:pointer;font-family:inherit;white-space:nowrap;transition:opacity 0.15s;}
    .comp-nf-btn:hover{opacity:0.88;}
    .comp-nf-btn:disabled{opacity:0.55;cursor:not-allowed;}
    .comp-nf-privacy{margin-top:0.75rem;font-size:0.75rem;color:#9ca3af;}
    .comp-nf-status{margin-top:0.75rem;font-size:0.88rem;padding:0.6rem 0.9rem;border-radius:8px;display:none;}
    .comp-nf-status.ok{background:#ecfdf5;color:#065f46;display:block;}
    .comp-nf-status.err{background:#fef2f2;color:#991b1b;display:block;}
  </style>
  <div class="comp-nf-inner">
    <h2>Resta aggiornato</h2>
    <p>Iscriviti alla newsletter e ricevi novità, risorse e offerte esclusive.</p>
    <form class="comp-nf-form" novalidate>
      <div class="comp-nf-row">
        <input class="comp-nf-input" type="email" name="email" placeholder="tua@email.com" autocomplete="email" required>
        <button class="comp-nf-btn" type="submit">Iscriviti</button>
      </div>
      <div class="comp-nf-privacy">Nessuno spam. Cancellati in qualsiasi momento. 🔒</div>
      <div class="comp-nf-status" id="comp-nf-status"></div>
    </form>
  </div>
  <script>
    (function(){
      var form=document.querySelector('.comp-nf-form');
      if(!form)return;
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var email=form.querySelector('input[type=email]');
        var btn=form.querySelector('.comp-nf-btn');
        var status=document.getElementById('comp-nf-status');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)){status.className='comp-nf-status err';status.textContent='Inserisci un\'email valida.';return;}
        btn.disabled=true;btn.textContent='…';status.className='comp-nf-status';status.textContent='';
        fetch('/api/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value})})
          .then(function(r){return r.ok?r.json():Promise.reject();})
          .then(function(){status.className='comp-nf-status ok';status.textContent='Iscrizione avvenuta! Grazie.';email.value='';})
          .catch(function(){status.className='comp-nf-status err';status.textContent='Errore. Riprova più tardi.';})
          .finally(function(){btn.disabled=false;btn.textContent='Iscriviti';});
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'cookie-banner',
    name: 'Cookie Banner GDPR',
    description: 'Banner consenso cookie con accetta/rifiuta, persistente in localStorage',
    category: 'utility',
    tags: ['cookie', 'gdpr', 'banner', 'consenso', 'privacy', 'cookies'],
    html: `<div class="comp-ck-banner" id="comp-ck-banner" role="dialog" aria-label="Cookie consent" style="display:none;">
  <style>
    .comp-ck-banner{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--color-bg,#ffffff);border-top:1px solid #e5e7eb;padding:1rem 1.5rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;font-family:var(--font-body,system-ui,sans-serif);box-shadow:0 -2px 12px rgba(0,0,0,0.08);}
    .comp-ck-text{flex:1;min-width:240px;font-size:0.88rem;color:var(--color-text,#1a1a1a);line-height:1.5;}
    .comp-ck-text a{color:var(--color-accent,#2563eb);text-decoration:underline;}
    .comp-ck-actions{display:flex;gap:0.6rem;flex-shrink:0;}
    .comp-ck-btn{padding:0.55rem 1.1rem;border-radius:var(--radius,10px);font-size:0.85rem;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:opacity 0.15s;}
    .comp-ck-btn:hover{opacity:0.85;}
    .comp-ck-accept{background:var(--color-accent,#2563eb);color:#fff;}
    .comp-ck-reject{background:transparent;color:var(--color-text,#1a1a1a);border:1.5px solid #d1d5db !important;}
  </style>
  <div class="comp-ck-text">
    Utilizziamo i cookie per migliorare la tua esperienza e analizzare il traffico. Leggi la nostra <a href="#">Privacy Policy</a>.
  </div>
  <div class="comp-ck-actions">
    <button class="comp-ck-btn comp-ck-reject" id="comp-ck-reject">Solo necessari</button>
    <button class="comp-ck-btn comp-ck-accept" id="comp-ck-accept">Accetta tutti</button>
  </div>
  <script>
    (function(){
      var banner=document.getElementById('comp-ck-banner');
      if(!banner)return;
      if(!localStorage.getItem('cookie-consent')){banner.style.display='flex';}
      function dismiss(val){localStorage.setItem('cookie-consent',val);banner.style.display='none';}
      document.getElementById('comp-ck-accept').addEventListener('click',function(){dismiss('all');});
      document.getElementById('comp-ck-reject').addEventListener('click',function(){dismiss('necessary');});
    })();
  </script>
</div>`,
  },
  {
    id: 'pricing-toggle',
    name: 'Pricing Toggle',
    description: 'Switch mensile/annuale con risparmio evidenziato e 3 piani',
    category: 'content',
    tags: ['pricing', 'prezzi', 'toggle', 'piano', 'mensile', 'annuale', 'abbonamento', 'piani'],
    html: `<section class="comp-pt-section" style="padding:3rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);">
  <style>
    .comp-pt-section h2{text-align:center;font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-pt-sub{text-align:center;color:#6b7280;margin-bottom:1.75rem;font-size:0.95rem;}
    .comp-pt-toggle-row{display:flex;align-items:center;justify-content:center;gap:0.75rem;margin-bottom:2rem;}
    .comp-pt-toggle-label{font-size:0.9rem;font-weight:600;color:#6b7280;}
    .comp-pt-toggle-label.active{color:var(--color-text,#1a1a1a);}
    .comp-pt-switch{position:relative;display:inline-block;width:48px;height:26px;}
    .comp-pt-switch input{opacity:0;width:0;height:0;}
    .comp-pt-slider{position:absolute;cursor:pointer;inset:0;background:#d1d5db;border-radius:26px;transition:0.2s;}
    .comp-pt-slider::before{content:'';position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.2s;}
    input:checked+.comp-pt-slider{background:var(--color-accent,#2563eb);}
    input:checked+.comp-pt-slider::before{transform:translateX(22px);}
    .comp-pt-badge{background:#ecfdf5;color:#065f46;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:99px;}
    .comp-pt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.25rem;max-width:900px;margin:0 auto;}
    .comp-pt-card{border:1.5px solid #e5e7eb;border-radius:var(--radius,10px);padding:1.75rem;display:flex;flex-direction:column;gap:0.75rem;transition:box-shadow 0.2s;}
    .comp-pt-card.featured{border-color:var(--color-accent,#2563eb);box-shadow:0 4px 24px rgba(37,99,235,0.12);}
    .comp-pt-plan{font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-accent,#2563eb);}
    .comp-pt-price{font-size:2.25rem;font-weight:800;color:var(--color-text,#1a1a1a);line-height:1;}
    .comp-pt-price span{font-size:1rem;font-weight:500;color:#6b7280;}
    .comp-pt-desc{font-size:0.88rem;color:#6b7280;line-height:1.5;}
    .comp-pt-divider{border:none;border-top:1px solid #e5e7eb;margin:0.25rem 0;}
    .comp-pt-features{list-style:none;margin:0;padding:0;font-size:0.88rem;color:var(--color-text,#1a1a1a);display:flex;flex-direction:column;gap:0.5rem;}
    .comp-pt-features li::before{content:'✓ ';color:var(--color-accent,#2563eb);font-weight:700;}
    .comp-pt-cta{margin-top:auto;padding:0.7rem;border-radius:var(--radius,10px);font-weight:600;font-size:0.95rem;cursor:pointer;border:none;font-family:inherit;transition:opacity 0.15s;text-align:center;text-decoration:none;display:block;}
    .comp-pt-cta.primary{background:var(--color-accent,#2563eb);color:#fff;}
    .comp-pt-cta.secondary{background:transparent;color:var(--color-accent,#2563eb);border:1.5px solid var(--color-accent,#2563eb);}
    .comp-pt-cta:hover{opacity:0.85;}
  </style>
  <h2>Scegli il tuo piano</h2>
  <p class="comp-pt-sub">Prova gratuita 14 giorni. Nessuna carta di credito richiesta.</p>
  <div class="comp-pt-toggle-row">
    <span class="comp-pt-toggle-label active" id="comp-pt-lbl-m">Mensile</span>
    <label class="comp-pt-switch">
      <input type="checkbox" id="comp-pt-toggle">
      <span class="comp-pt-slider"></span>
    </label>
    <span class="comp-pt-toggle-label" id="comp-pt-lbl-a">Annuale <span class="comp-pt-badge">Risparmia 20%</span></span>
  </div>
  <div class="comp-pt-grid">
    <div class="comp-pt-card">
      <div class="comp-pt-plan">Basic</div>
      <div class="comp-pt-price"><span data-m="9" data-a="7">9</span><span>/mo</span></div>
      <p class="comp-pt-desc">Perfetto per freelancer e piccoli progetti.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>1 sito web</li>
        <li>5 GB storage</li>
        <li>Supporto email</li>
      </ul>
      <a href="#" class="comp-pt-cta secondary">Inizia gratis</a>
    </div>
    <div class="comp-pt-card featured">
      <div class="comp-pt-plan">Pro ⭐</div>
      <div class="comp-pt-price"><span data-m="29" data-a="23">29</span><span>/mo</span></div>
      <p class="comp-pt-desc">Ideale per team in crescita e agenzie.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>10 siti web</li>
        <li>50 GB storage</li>
        <li>Supporto prioritario</li>
        <li>Analytics avanzati</li>
      </ul>
      <a href="#" class="comp-pt-cta primary">Inizia gratis</a>
    </div>
    <div class="comp-pt-card">
      <div class="comp-pt-plan">Enterprise</div>
      <div class="comp-pt-price"><span data-m="79" data-a="63">79</span><span>/mo</span></div>
      <p class="comp-pt-desc">Per grandi team e aziende enterprise.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>Siti illimitati</li>
        <li>Storage illimitato</li>
        <li>Supporto 24/7</li>
        <li>SLA garantito</li>
      </ul>
      <a href="#" class="comp-pt-cta secondary">Contattaci</a>
    </div>
  </div>
  <script>
    (function(){
      var toggle=document.getElementById('comp-pt-toggle');
      var lblM=document.getElementById('comp-pt-lbl-m');
      var lblA=document.getElementById('comp-pt-lbl-a');
      if(!toggle)return;
      toggle.addEventListener('change',function(){
        var annual=this.checked;
        lblM.classList.toggle('active',!annual);
        lblA.classList.toggle('active',annual);
        document.querySelectorAll('.comp-pt-price [data-m]').forEach(function(el){
          el.textContent=annual?el.getAttribute('data-a'):el.getAttribute('data-m');
        });
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'data-table',
    name: 'Tabella Dati',
    description: 'Tabella personalizzabile con intestazioni e righe dati, responsive',
    category: 'content',
    tags: ['tabella', 'table', 'dati', 'righe', 'colonne', 'grid', 'confronto'],
    html: `<section class="comp-dt-section" style="padding:2rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);">
  <style>
    .comp-dt-section h2{font-size:1.5rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:1.25rem;}
    .comp-dt-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
    .comp-dt-table{width:100%;border-collapse:collapse;min-width:480px;font-size:0.9rem;}
    .comp-dt-table thead{position:sticky;top:0;z-index:1;}
    .comp-dt-table th{background:var(--color-accent,#2563eb);color:#fff;padding:0.75rem 1rem;text-align:left;font-weight:600;white-space:nowrap;}
    .comp-dt-table th:first-child{border-radius:var(--radius,10px) 0 0 0;}
    .comp-dt-table th:last-child{border-radius:0 var(--radius,10px) 0 0;}
    .comp-dt-table td{padding:0.7rem 1rem;border-bottom:1px solid #e5e7eb;color:var(--color-text,#1a1a1a);}
    .comp-dt-table tbody tr:nth-child(even){background:#f8fafc;}
    .comp-dt-table tbody tr:hover{background:#eff6ff;}
    .comp-dt-table tbody tr:last-child td{border-bottom:none;}
    .comp-dt-table tbody tr:last-child td:first-child{border-radius:0 0 0 var(--radius,10px);}
    .comp-dt-table tbody tr:last-child td:last-child{border-radius:0 0 var(--radius,10px) 0;}
  </style>
  <h2>Tabella Dati</h2>
  <div class="comp-dt-scroll">
    <table class="comp-dt-table">
      <thead>
        <tr>
          <th>Prodotto</th>
          <th>Categoria</th>
          <th>Prezzo</th>
          <th>Disponibilità</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Prodotto Alpha</td><td>Categoria A</td><td>€ 49,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Beta</td><td>Categoria B</td><td>€ 99,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Gamma</td><td>Categoria A</td><td>€ 149,00</td><td>⚠️ Limitato</td></tr>
        <tr><td>Prodotto Delta</td><td>Categoria C</td><td>€ 29,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Epsilon</td><td>Categoria B</td><td>€ 199,00</td><td>❌ Esaurito</td></tr>
      </tbody>
    </table>
  </div>
</section>`,
  },
  {
    id: 'stats-row',
    name: 'Riga Statistiche',
    description: 'Una riga di 3-4 stat chiave: numero grande + etichetta. Perfetta sotto l\'hero o in sezioni "social proof" numerica.',
    category: 'content',
    tags: ['statistiche', 'stats', 'numeri', 'cifre', 'metriche', 'kpi', 'social proof', 'counter'],
    paramSchema: `stats: [{value: string, label: string}]  — max 4 items`,
    render: renderStatsRow,
    html: renderStatsRow({
      stats: [
        { value: '10.000+', label: 'Clienti attivi' },
        { value: '99.9%',   label: 'Uptime garantito' },
        { value: '4.8★',    label: 'Valutazione media' },
      ],
    }),
  },
  {
    id: 'cta-banner',
    name: 'CTA Banner',
    description: 'Sezione full-width con sfondo accent, titolo, sottotitolo e CTA button bianco. Ideale come sezione di chiusura o invito all\'azione.',
    category: 'content',
    tags: ['cta', 'call to action', 'banner', 'pulsante', 'button', 'conversione', 'promo', 'invito'],
    paramSchema: `title: string, subtitle: string, buttonText: string, buttonHref: string`,
    render: renderCtaBanner,
    html: renderCtaBanner({
      title: 'Pronto a iniziare?',
      subtitle: 'Crea il tuo sito in pochi minuti, senza scrivere codice.',
      buttonText: 'Inizia gratis →',
      buttonHref: '#',
    }),
  },
  {
    id: 'testimonial-grid',
    name: 'Griglia Testimonianze',
    description: '3 card testimonianze in griglia responsive (3 col desktop, 1 mobile) con stelle, citazione, avatar con iniziali, nome e ruolo.',
    category: 'social-proof',
    tags: ['testimonianze', 'testimonial', 'recensioni', 'reviews', 'social proof', 'clienti', 'feedback', 'stelle'],
    html: `<section class="tg-section">
  <style>
    .tg-section{padding:4rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);}
    .tg-inner{max-width:1100px;margin:0 auto;}
    .tg-header{text-align:center;margin-bottom:2.5rem;}
    .tg-header h2{font-size:2rem;font-weight:800;color:var(--color-text,#1a1a1a);margin:0 0 .5rem;}
    .tg-header p{color:#6b7280;font-size:1rem;margin:0;}
    .tg-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.25rem;}
    .tg-card{background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:1.75rem;display:flex;flex-direction:column;gap:1rem;}
    .tg-stars{color:#f59e0b;font-size:1rem;letter-spacing:2px;}
    .tg-quote{font-size:0.95rem;line-height:1.65;color:#374151;flex:1;font-style:italic;}
    .tg-author{display:flex;align-items:center;gap:0.75rem;}
    .tg-avatar{width:42px;height:42px;border-radius:50%;background:var(--color-accent,#2563eb);color:#fff;font-weight:700;font-size:0.9rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .tg-name{font-weight:700;font-size:0.92rem;color:var(--color-text,#1a1a1a);}
    .tg-role{font-size:0.8rem;color:#9ca3af;}
    @media(max-width:760px){.tg-grid{grid-template-columns:1fr;}}
  </style>
  <div class="tg-inner">
    <div class="tg-header">
      <h2>Cosa dicono i nostri clienti</h2>
      <p>Migliaia di aziende già ci hanno scelto.</p>
    </div>
    <div class="tg-grid">
      <div class="tg-card">
        <div class="tg-stars">★★★★★</div>
        <p class="tg-quote">"Abbiamo ridotto i tempi di sviluppo del 60%. Il builder è intuitivo e il supporto è sempre disponibile. Lo consiglio a chiunque."</p>
        <div class="tg-author">
          <div class="tg-avatar">ML</div>
          <div>
            <div class="tg-name">Marco Lombardi</div>
            <div class="tg-role">CTO · Nexura S.r.l.</div>
          </div>
        </div>
      </div>
      <div class="tg-card">
        <div class="tg-stars">★★★★★</div>
        <p class="tg-quote">"Finalmente uno strumento che unisce semplicità e potenza. Ho lanciato il sito della mia startup in un pomeriggio, senza toccare codice."</p>
        <div class="tg-author">
          <div class="tg-avatar">SF</div>
          <div>
            <div class="tg-name">Sofia Ferrari</div>
            <div class="tg-role">Founder · Bloom Studio</div>
          </div>
        </div>
      </div>
      <div class="tg-card">
        <div class="tg-stars">★★★★★</div>
        <p class="tg-quote">"Il ROI è stato immediato. I nostri clienti ora ricevono siti professionali in tempi record e la qualità è sempre alta. Un game changer."</p>
        <div class="tg-author">
          <div class="tg-avatar">AR</div>
          <div>
            <div class="tg-name">Andrea Russo</div>
            <div class="tg-role">Direttore Digitale · Gruppo Helix</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'process-steps',
    name: 'Passi del Processo',
    description: 'Sezione "Come funziona" con 3 step numerati in riga (desktop) o colonna (mobile), con linea connettrice tra i passi.',
    category: 'content',
    tags: ['come funziona', 'how it works', 'step', 'passi', 'processo', 'processo', 'funzionamento', 'guida'],
    html: `<section class="ps-section">
  <style>
    .ps-section{padding:4rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);}
    .ps-inner{max-width:960px;margin:0 auto;}
    .ps-header{text-align:center;margin-bottom:3rem;}
    .ps-header h2{font-size:2rem;font-weight:800;color:var(--color-text,#1a1a1a);margin:0 0 .5rem;}
    .ps-header p{color:#6b7280;font-size:1rem;margin:0;}
    .ps-row{display:flex;align-items:flex-start;gap:0;position:relative;}
    .ps-step{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 1.5rem;position:relative;}
    .ps-connector{flex:1;height:2px;background:linear-gradient(90deg,var(--color-accent,#2563eb),#dbeafe);align-self:flex-start;margin-top:28px;max-width:80px;}
    .ps-num{width:56px;height:56px;border-radius:50%;background:var(--color-accent,#2563eb);color:#fff;font-size:1.4rem;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:1rem;flex-shrink:0;box-shadow:0 4px 14px rgba(37,99,235,0.25);}
    .ps-title{font-size:1.05rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.4rem;}
    .ps-desc{font-size:0.88rem;color:#6b7280;line-height:1.6;}
    @media(max-width:640px){
      .ps-row{flex-direction:column;align-items:center;gap:2rem;}
      .ps-connector{display:none;}
      .ps-step{padding:0;}
    }
  </style>
  <div class="ps-inner">
    <div class="ps-header">
      <h2>Come funziona</h2>
      <p>Tre semplici passi per andare online.</p>
    </div>
    <div class="ps-row">
      <div class="ps-step">
        <div class="ps-num">1</div>
        <div class="ps-title">Scegli un template</div>
        <p class="ps-desc">Sfoglia la nostra libreria di template professionali e scegli quello più adatto al tuo settore.</p>
      </div>
      <div class="ps-connector" aria-hidden="true"></div>
      <div class="ps-step">
        <div class="ps-num">2</div>
        <div class="ps-title">Personalizza i contenuti</div>
        <p class="ps-desc">Modifica testi, immagini e colori con il nostro editor visuale drag-and-drop, senza scrivere codice.</p>
      </div>
      <div class="ps-connector" aria-hidden="true"></div>
      <div class="ps-step">
        <div class="ps-num">3</div>
        <div class="ps-title">Pubblica online</div>
        <p class="ps-desc">Con un solo click il tuo sito va live su un dominio personalizzato, ottimizzato per mobile e SEO.</p>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'hero-split',
    name: 'Hero Split (due colonne)',
    description: 'Hero a due colonne: sinistra con titolo grande, sottotitolo e CTA; destra con box gradiente decorativo. Responsive.',
    category: 'content',
    tags: ['hero', 'header', 'homepage', 'intestazione', 'split', 'due colonne', 'landing', 'above the fold'],
    html: `<section class="hs-section">
  <style>
    .hs-section{padding:5rem 1.5rem 4rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);}
    .hs-inner{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:center;}
    .hs-content{display:flex;flex-direction:column;gap:1.25rem;}
    .hs-eyebrow{display:inline-block;font-size:0.8rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-accent,#2563eb);background:#eff6ff;padding:4px 12px;border-radius:99px;}
    .hs-title{font-size:clamp(2rem,4vw,3.2rem);font-weight:900;line-height:1.1;color:var(--color-text,#1a1a1a);margin:0;letter-spacing:-0.03em;}
    .hs-title .hs-accent{color:var(--color-accent,#2563eb);}
    .hs-subtitle{font-size:1.1rem;color:#4b5563;line-height:1.65;margin:0;}
    .hs-actions{display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:0.25rem;}
    .hs-btn-primary{padding:0.8rem 1.75rem;background:var(--color-accent,#2563eb);color:#fff;font-weight:700;font-size:1rem;border-radius:var(--radius,10px);text-decoration:none;border:none;cursor:pointer;transition:opacity 0.15s,transform 0.15s;font-family:inherit;}
    .hs-btn-primary:hover{opacity:0.9;transform:translateY(-1px);}
    .hs-btn-secondary{padding:0.8rem 1.75rem;background:transparent;color:var(--color-text,#1a1a1a);font-weight:600;font-size:1rem;border-radius:var(--radius,10px);text-decoration:none;border:1.5px solid #d1d5db;cursor:pointer;transition:border-color 0.15s;font-family:inherit;}
    .hs-btn-secondary:hover{border-color:var(--color-accent,#2563eb);}
    .hs-visual{aspect-ratio:4/3;border-radius:20px;background:linear-gradient(135deg,var(--color-accent,#2563eb) 0%,#7c3aed 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 24px 60px rgba(37,99,235,0.25);overflow:hidden;position:relative;}
    .hs-visual::before{content:'';position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.06'%3E%3Ccircle cx='30' cy='30' r='20'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;}
    .hs-visual-label{color:rgba(255,255,255,0.7);font-size:0.85rem;font-weight:500;position:relative;z-index:1;}
    @media(max-width:768px){
      .hs-inner{grid-template-columns:1fr;gap:2rem;}
      .hs-visual{order:-1;max-height:260px;}
    }
  </style>
  <div class="hs-inner">
    <div class="hs-content">
      <span class="hs-eyebrow">Nuovo · 2025</span>
      <h1 class="hs-title">Il modo più <span class="hs-accent">veloce</span> per costruire il tuo sito</h1>
      <p class="hs-subtitle">Crea siti web professionali con l'intelligenza artificiale. Nessun codice, nessuna complessità — solo risultati.</p>
      <div class="hs-actions">
        <a href="#" class="hs-btn-primary">Inizia gratis →</a>
        <a href="#" class="hs-btn-secondary">Guarda la demo</a>
      </div>
    </div>
    <div class="hs-visual" aria-hidden="true">
      <span class="hs-visual-label">Anteprima prodotto</span>
    </div>
  </div>
</section>`,
  },
  {
    id: 'announcement-bar',
    name: 'Barra Annuncio',
    description: 'Barra slim fissa in cima (44px, z-index 9999) con messaggio centrato e pulsante × per chiudere. Aggiusta il margin-top del body automaticamente.',
    category: 'utility',
    tags: ['annuncio', 'announcement', 'banner', 'barra', 'avviso', 'novità', 'promo', 'top bar', 'notifica'],
    html: `<div class="ab-bar" id="ab-bar" role="banner">
  <style>
    .ab-bar{position:fixed;top:0;left:0;right:0;z-index:9999;height:44px;background:var(--color-accent,#2563eb);color:#ffffff;display:flex;align-items:center;justify-content:center;font-family:var(--font-body,system-ui,sans-serif);font-size:0.875rem;font-weight:500;padding:0 3rem;}
    .ab-msg{text-align:center;line-height:1.2;}
    .ab-msg a{color:#ffffff;text-decoration:underline;font-weight:700;}
    .ab-close{position:absolute;right:1rem;top:50%;transform:translateY(-50%);background:none;border:none;color:#ffffff;font-size:1.25rem;line-height:1;cursor:pointer;padding:0 4px;opacity:0.8;font-family:inherit;}
    .ab-close:hover{opacity:1;}
  </style>
  <span class="ab-msg">🎉 Novità: scopri le nuove funzionalità → <a href="#">Leggi di più</a></span>
  <button class="ab-close" id="ab-close" aria-label="Chiudi annuncio">×</button>
  <script>
    (function(){
      var bar=document.getElementById('ab-bar');
      var closeBtn=document.getElementById('ab-close');
      if(!bar||!closeBtn)return;
      document.body.style.marginTop='44px';
      closeBtn.addEventListener('click',function(){
        bar.style.display='none';
        document.body.style.marginTop='0';
      });
    })();
  </script>
</div>`,
  },
]

export function findComponentByKeywords(text: string): Component | null {
  const lower = text.toLowerCase()
  return COMPONENT_REGISTRY.find(c =>
    c.tags.some(tag => lower.includes(tag)) || lower.includes(c.id)
  ) ?? null
}

/** All components that support parametric `render` (and thus the `insert_component` agent tool). */
export const SMART_COMPONENTS: Component[] = COMPONENT_REGISTRY.filter(c => typeof c.render === 'function')

/**
 * Render a smart component by id with the given data. Returns the final HTML
 * (no token cost — pure server-side rendering).
 * Throws if the component doesn't exist or isn't smart.
 */
export function renderComponentById(componentId: string, data: Record<string, unknown>): string {
  const comp = COMPONENT_REGISTRY.find(c => c.id === componentId)
  if (!comp) throw new Error(`Component "${componentId}" not found`)
  if (!comp.render) throw new Error(`Component "${componentId}" doesn't support parametric rendering`)
  return comp.render(data)
}
