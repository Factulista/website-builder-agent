/**
 * Categorised 3-column layout for the "Funcionalidades" mega-menu panel.
 *
 * Used by every copy of rebuildMegaMenuPanel (lib/preview.ts, lib/blog-serve.ts,
 * app/projects/[id]/page.tsx). Pure module: no server/client-only imports.
 *
 * ⚠️ The markup must NOT contain any <div>: rebuildMegaMenuPanel finds the end of
 * a panel with indexOf('</div>'), so a nested div would make the next rebuild cut
 * the panel in half (stored shared_nav_html can contain this markup after a
 * builder autosave).
 */

type MegaPageLike = { slug: string }

type Item = { slug: string; name: string; desc: string }
type Column = { title: string; icon: string; tone: 'blue' | 'green' | 'yellow'; items: Item[] }

const COLUMNS: Column[] = [
  {
    title: 'Facturar', icon: '🧾', tone: 'blue', items: [
      { slug: 'facturacion-verifactu', name: 'Facturación VeriFactu', desc: 'Crea y envía facturas que cumplen con Hacienda' },
      { slug: 'facturacion-con-ia-chatgpt-claude', name: 'Facturación con IA', desc: 'Prepara tus facturas en menos pasos' },
    ],
  },
  {
    title: 'Cobros y gastos', icon: '💳', tone: 'green', items: [
      { slug: 'control-de-pagos-y-cobros', name: 'Control de pagos y cobros', desc: 'Sabe qué te deben y qué ya has cobrado' },
      { slug: 'gestion-de-facturas-recibidas-y-gastos', name: 'Facturas recibidas y gastos', desc: 'Guarda tickets y facturas de proveedores' },
      { slug: 'gestion-de-clientes-y-proveedores', name: 'Clientes y proveedores', desc: 'Todos tus contactos en un solo sitio' },
    ],
  },
  {
    title: 'Control y normativa', icon: '📊', tone: 'yellow', items: [
      { slug: 'informes-avanzados', name: 'Informes avanzados', desc: 'Ingresos y gastos de tu negocio de un vistazo' },
      { slug: 'cumplimiento-normativo', name: 'Cumplimiento normativo', desc: 'Al día con VeriFactu y la normativa vigente' },
    ],
  },
]

/** Inner HTML for the panel, or null if none of the mapped pages is available. */
export function buildFuncionalidadesMega(megaPages: MegaPageLike[]): string | null {
  const available = new Set(megaPages.map(p => p.slug))
  const cols = COLUMNS.map(c => ({ ...c, items: c.items.filter(i => available.has(i.slug)) })).filter(c => c.items.length)
  if (!cols.length) return null
  const colsHtml = cols.map(c => {
    const links = c.items.map(i =>
      `<a class="fct-mega-link" role="menuitem" href="./${i.slug}"><span class="fct-mega-name">${i.name}</span><span class="fct-mega-desc">${i.desc}</span></a>`
    ).join('')
    return `<span class="fct-mega-col"><span class="fct-mega-head"><span class="fct-mega-icon fct-mega-icon--${c.tone}" aria-hidden="true">${c.icon}</span><span class="fct-mega-title">${c.title}</span></span>${links}</span>`
  }).join('')
  return `<span class="fct-mega-grid">${colsHtml}</span><span class="fct-mega-foot"><a href="./funcionalidades" role="menuitem">Ver todas las funcionalidades →</a></span>`
}

const P = '.comp-nfd-panel[data-layout="fct-mega"]'

export const FUNC_MEGA_CSS = `${P}{width:720px!important;max-width:min(95vw,720px)!important;padding:24px 24px 0!important;border-radius:16px!important;background:#fff!important;box-shadow:0 12px 40px rgba(20,20,20,.12),0 2px 6px rgba(20,20,20,.05)!important;font-family:'Space Grotesk',system-ui,-apple-system,sans-serif!important;box-sizing:border-box!important;}` +
  `.comp-nfd[data-open="true"] ${P}{display:block!important;}` +
  `${P} *{box-sizing:border-box!important;}` +
  `${P} .fct-mega-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:8px 20px!important;}` +
  `${P} .fct-mega-col{display:flex!important;flex-direction:column!important;min-width:0!important;}` +
  `${P} .fct-mega-head{display:flex!important;align-items:center!important;gap:8px!important;margin:0 0 8px!important;padding:0 10px!important;}` +
  `${P} .fct-mega-icon{width:26px!important;height:26px!important;border-radius:50%!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:14px!important;line-height:1!important;flex-shrink:0!important;}` +
  `${P} .fct-mega-icon--blue{background:#e6eefc!important;}${P} .fct-mega-icon--green{background:#e3f5ea!important;}${P} .fct-mega-icon--yellow{background:#fdf3d6!important;}` +
  `${P} .fct-mega-title{font-size:13px!important;font-weight:600!important;color:#111!important;margin:0!important;}` +
  `${P} .fct-mega-link{display:block!important;padding:9px 10px!important;border-radius:10px!important;text-decoration:none!important;white-space:normal!important;transition:background-color .15s ease!important;}` +
  `${P} .fct-mega-link:hover{background:#f5f5f4!important;}${P} .fct-mega-link:focus-visible{outline:2px solid #111!important;outline-offset:1px!important;}` +
  `${P} .fct-mega-name{display:block!important;font-size:14px!important;font-weight:500!important;color:#2b2b2b!important;line-height:1.3!important;}` +
  `${P} .fct-mega-desc{display:block!important;font-size:12.5px!important;font-weight:400!important;color:#8a8a8a!important;line-height:1.4!important;margin-top:2px!important;}` +
  `${P} .fct-mega-foot{display:block!important;border-top:1px solid #ececec!important;margin-top:16px!important;padding:14px 0!important;text-align:center!important;}` +
  `${P} .fct-mega-foot a{font-size:14px!important;font-weight:500!important;color:#555!important;text-decoration:none!important;}${P} .fct-mega-foot a:hover{color:#111!important;}` +
  `@media(max-width:720px){${P} .fct-mega-grid{grid-template-columns:1fr 1fr!important;}}` +
  `@media(max-width:640px){${P}{width:auto!important;max-width:none!important;padding:16px 12px 0!important;border-radius:12px 12px 0 0!important;}${P} .fct-mega-grid{grid-template-columns:1fr!important;gap:14px!important;}}` +
  `@media(prefers-reduced-motion:reduce){${P} .fct-mega-link{transition:none!important;}}`

// ── Comparativas: 2-column compact list with letter avatars ──────────────────

type CompItem = { slug: string; name: string; letter: string; tone: string }
const COMPARATIVAS: CompItem[] = [
  { slug: 'programa-de-facturacion-alternativo-a-la-aplicacion-verifactu-de-la-aeat', name: 'Aplicación VeriFactu AEAT', letter: 'A', tone: 'blue' },
  { slug: 'programa-de-facturacion-alternativo-a-a3factura', name: 'a3factura', letter: 'a3', tone: 'orange' },
  { slug: 'programa-de-facturacion-alternativo-a-facturas-billin', name: 'Billin', letter: 'B', tone: 'green' },
  { slug: 'programa-de-facturacion-alternativo-a-contasimple', name: 'Contasimple', letter: 'C', tone: 'purple' },
  { slug: 'programa-de-facturacion-alternativo-a-factusol', name: 'Factusol', letter: 'F', tone: 'yellow' },
  { slug: 'programa-de-facturacion-alternativo-a-holded', name: 'Holded', letter: 'H', tone: 'pink' },
  { slug: 'programa-de-facturacion-alternativo-a-quipu', name: 'Quipu', letter: 'Q', tone: 'teal' },
  { slug: 'programa-de-facturacion-alternativo-a-sage', name: 'Sage Active', letter: 'S', tone: 'grey' },
]

type LabelledPage = MegaPageLike & { megaMenuLabel?: string; menuLabel?: string; name?: string }

/** Inner HTML for the Comparativas panel: known competitors in fixed order, then any other page of the group. */
export function buildComparativasMega(megaPages: LabelledPage[]): string | null {
  const bySlug = new Map(megaPages.map(p => [p.slug, p]))
  const known = new Set(COMPARATIVAS.map(c => c.slug))
  const items: CompItem[] = COMPARATIVAS.filter(c => bySlug.has(c.slug))
  for (const p of megaPages) {
    if (known.has(p.slug)) continue
    const raw = p.megaMenuLabel ?? p.menuLabel ?? p.name ?? p.slug
    const name = raw.includes('|') ? raw.split('|').pop()!.trim() : raw
    items.push({ slug: p.slug, name, letter: name.charAt(0).toUpperCase(), tone: 'grey' })
  }
  if (!items.length) return null
  const rows = Math.ceil(items.length / 2)
  const links = items.map(i =>
    `<a class="fct-mega-link fct-mega-link--icon" role="menuitem" href="./${i.slug}"><span class="fct-mega-icon fct-mega-icon--letter fct-mega-icon--${i.tone}" aria-hidden="true">${i.letter}</span><span class="fct-mega-name">${i.name}</span></a>`
  ).join('')
  return `<span class="fct-mega-grid fct-mega-grid--two" style="grid-template-rows:repeat(${rows},auto)">${links}</span>`
}

/** Layout override for a mega-menu group, or null to keep the default flat list. */
export function buildMegaLayout(groupKey: string, megaPages: LabelledPage[]): { html: string; layout: string } | null {
  if (groupKey === 'funcionalidades') { const html = buildFuncionalidadesMega(megaPages); return html ? { html, layout: 'fct-mega' } : null }
  if (groupKey === 'comparativas') { const html = buildComparativasMega(megaPages); return html ? { html, layout: 'fct-mega-two' } : null }
  if (groupKey === 'asesorias') { const html = buildAsesoriasMega(megaPages); return html ? { html, layout: 'fct-mega-single' } : null }
  return null
}

const Q = '.comp-nfd-panel[data-layout="fct-mega-two"]'

export const COMP_MEGA_CSS = `${Q}{width:560px!important;max-width:min(95vw,560px)!important;padding:16px!important;border-radius:16px!important;background:#fff!important;box-shadow:0 12px 40px rgba(20,20,20,.12),0 2px 6px rgba(20,20,20,.05)!important;font-family:'Space Grotesk',system-ui,-apple-system,sans-serif!important;box-sizing:border-box!important;}` +
  `.comp-nfd[data-open="true"] ${Q}{display:block!important;}` +
  `${Q} *{box-sizing:border-box!important;}` +
  `${Q} .fct-mega-grid--two{display:grid!important;grid-template-columns:1fr 1fr!important;grid-auto-flow:column!important;gap:2px 12px!important;}` +
  `${Q} .fct-mega-link--icon{display:flex!important;align-items:center!important;gap:12px!important;padding:10px!important;border-radius:10px!important;text-decoration:none!important;transition:background-color .15s ease!important;}` +
  `${Q} .fct-mega-link--icon:hover{background:#f5f5f4!important;}${Q} .fct-mega-link--icon:focus-visible{outline:2px solid #111!important;outline-offset:1px!important;}` +
  `${Q} .fct-mega-icon{width:32px!important;height:32px!important;border-radius:50%!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;line-height:1!important;flex-shrink:0!important;}` +
  `${Q} .fct-mega-icon--letter{font-size:13px!important;font-weight:600!important;color:#2b2b2b!important;}` +
  `${Q} .fct-mega-icon--blue{background:#e6eefc!important;}${Q} .fct-mega-icon--green{background:#e3f5ea!important;}${Q} .fct-mega-icon--yellow{background:#fdf3d6!important;}${Q} .fct-mega-icon--pink{background:#fbe7ef!important;}${Q} .fct-mega-icon--purple{background:#eeeafc!important;}${Q} .fct-mega-icon--orange{background:#fdebdc!important;}${Q} .fct-mega-icon--teal{background:#dff4f3!important;}${Q} .fct-mega-icon--grey{background:#efefed!important;}` +
  `${Q} .fct-mega-name{display:block!important;font-size:14px!important;font-weight:500!important;color:#2b2b2b!important;line-height:1.3!important;white-space:nowrap!important;}` +
  `@media(max-width:640px){${Q}{width:auto!important;max-width:none!important;padding:12px!important;border-radius:12px 12px 0 0!important;}${Q} .fct-mega-grid--two{grid-template-columns:1fr!important;grid-template-rows:none!important;grid-auto-flow:row!important;}}` +
  `@media(prefers-reduced-motion:reduce){${Q} .fct-mega-link--icon{transition:none!important;}}`

/** All mega-menu layout CSS (inject once wherever MEGA_MENU_CSS goes). */
export const MEGA_LAYOUT_CSS = () => FUNC_MEGA_CSS + COMP_MEGA_CSS + RES_MEGA_CSS

// ── Recursos: single-column list with icon + description ────────────────────
// Static panel (no page group): rebuilt at serve time by rebuildRecursosPanel().

type ResItem = { slug: string; name: string; desc: string; icon: string; tone: string }
const RECURSOS: ResItem[] = [
  { slug: 'blog', name: 'Blog', desc: 'Guías sobre VeriFactu, impuestos y facturación', icon: '📚', tone: 'blue' },
  { slug: 'ayuda', name: 'Ayuda', desc: 'Resuelve tus dudas sobre cómo usar Factulista', icon: '💬', tone: 'green' },
  { slug: 'migrar-a-factulista', name: 'Migración a Factulista', desc: 'Cámbiate desde tu programa actual sin empezar de cero', icon: '🔄', tone: 'yellow' },
]

/** Replaces the content of the Recursos panel (the untagged panel linking ./blog). */
export function rebuildRecursosPanel(html: string): string {
  const openRe = /<div class="comp-nfd-panel"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = openRe.exec(html)) !== null) {
    const open = m[0]
    if (/data-mega-group=/.test(open)) continue
    const bodyStart = m.index + open.length
    const closeIdx = html.indexOf('</div>', bodyStart)
    if (closeIdx === -1) continue
    const body = html.slice(bodyStart, closeIdx)
    // Blog/help pages store absolute hrefs (https://host/blog), site pages relative ones (./blog):
    // keep whatever prefix the stored panel uses.
    const hm = body.match(/href="((?:\.\/|https?:\/\/[^"]*\/))blog"/)
    if (!hm && !/\sid="nfd-recursos"/.test(open)) continue
    const prefix = hm ? hm[1] : './'
    const links = RECURSOS.map(i =>
      `<a class="fct-mega-link fct-mega-link--icon" role="menuitem" href="${prefix}${i.slug}"><span class="fct-mega-icon fct-mega-icon--${i.tone}" aria-hidden="true">${i.icon}</span><span class="fct-mega-text"><span class="fct-mega-name">${i.name}</span><span class="fct-mega-desc">${i.desc}</span></span></a>`
    ).join('')
    let newOpen = open.replace(/\sdata-layout="[^"]*"/, '').replace(/\sdata-count="[^"]*"/, '')
    newOpen = newOpen.replace(/>$/, ` data-count="${RECURSOS.length}" data-layout="fct-mega-single">`)
    return html.slice(0, m.index) + newOpen + links + html.slice(closeIdx)
  }
  return html
}

const R = '.comp-nfd-panel[data-layout="fct-mega-single"]'
export const RES_MEGA_CSS = `${R}{width:340px!important;max-width:min(95vw,340px)!important;padding:12px!important;border-radius:16px!important;background:#fff!important;box-shadow:0 12px 40px rgba(20,20,20,.12),0 2px 6px rgba(20,20,20,.05)!important;font-family:'Space Grotesk',system-ui,-apple-system,sans-serif!important;box-sizing:border-box!important;}` +
  `.comp-nfd[data-open="true"] ${R}{display:flex!important;flex-direction:column!important;gap:2px!important;}` +
  `${R} *{box-sizing:border-box!important;}` +
  `${R} .fct-mega-link--icon{display:flex!important;align-items:flex-start!important;gap:12px!important;padding:10px!important;border-radius:10px!important;text-decoration:none!important;white-space:normal!important;transition:background-color .15s ease!important;}` +
  `${R} .fct-mega-link--icon:hover{background:#f5f5f4!important;}${R} .fct-mega-link--icon:focus-visible{outline:2px solid #111!important;outline-offset:1px!important;}` +
  `${R} .fct-mega-icon{width:32px!important;height:32px!important;border-radius:50%!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:16px!important;line-height:1!important;flex-shrink:0!important;}` +
  `${R} .fct-mega-icon--blue{background:#e6eefc!important;}${R} .fct-mega-icon--green{background:#e3f5ea!important;}${R} .fct-mega-icon--yellow{background:#fdf3d6!important;}` +
  `${R} .fct-mega-text{display:block!important;min-width:0!important;}` +
  `${R} .fct-mega-name{display:block!important;font-size:14px!important;font-weight:500!important;color:#2b2b2b!important;line-height:1.3!important;}` +
  `${R} .fct-mega-desc{display:block!important;font-size:12.5px!important;font-weight:400!important;color:#8a8a8a!important;line-height:1.4!important;margin-top:2px!important;}` +
  `${R} .fct-mega-foot{display:block!important;border-top:1px solid #ececec!important;margin-top:6px!important;padding:12px 10px 4px!important;text-align:center!important;}${R} .fct-mega-foot a{font-size:14px!important;font-weight:500!important;color:#555!important;text-decoration:none!important;}${R} .fct-mega-foot a:hover{color:#111!important;}` +
  `@media(max-width:640px){${R}{width:auto!important;max-width:none!important;border-radius:12px 12px 0 0!important;}}` +
  `@media(prefers-reduced-motion:reduce){${R} .fct-mega-link--icon{transition:none!important;}}`

// ── Asesorías: dropdown injected only when the group has pages ──────────────
// Pages with megaMenu='asesorias' (drafts in the builder/preview, published pages
// on the live site). The <li> is inserted at render time before Funcionalidades,
// so the live nav shows it only once the pages are published.

const GROUP_LABELS: Record<string, string> = { asesorias: 'Asesorías' }
/** Human label for a mega-menu group key (accents where needed). */
export function megaGroupLabel(key: string): string {
  return GROUP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

const ASES_HUB = 'asesorias'
const ASESORIAS: ResItem[] = [
  { slug: 'programa-de-facturacion-para-clientes-de-asesorias', name: 'Factulista para tus clientes', desc: 'El programa de facturación VeriFactu para los autónomos y pymes que asesoras', icon: '🧾', tone: 'yellow' },
  { slug: 'software-de-gestion-para-asesorias', name: 'Factulista Despacho', desc: 'Gestiona tu asesoría: clientes, documentos, tareas y plazos fiscales', icon: '🗂️', tone: 'blue' },
]

function buildAsesoriasMega(megaPages: MegaPageLike[]): string | null {
  const have = new Set(megaPages.map(p => p.slug))
  const items = ASESORIAS.filter(i => have.has(i.slug))
  if (!items.length) return null
  const links = items.map(i =>
    `<a class="fct-mega-link fct-mega-link--icon" role="menuitem" href="./${i.slug}"><span class="fct-mega-icon fct-mega-icon--${i.tone}" aria-hidden="true">${i.icon}</span><span class="fct-mega-text"><span class="fct-mega-name">${i.name}</span><span class="fct-mega-desc">${i.desc}</span></span></a>`
  ).join('')
  const foot = `<span class="fct-mega-foot"><a href="./${ASES_HUB}" role="menuitem">Ver Factulista para asesorías →</a></span>`
  return links + foot
}

/** Inserts the Asesorías dropdown skeleton (before Funcionalidades) when the group has pages. */
export function ensureAsesoriasNav(html: string, megaPages: Array<MegaPageLike & { megaMenu?: string }>): string {
  // Needs at least one of the two product pages (the hub alone doesn't make a dropdown).
  if (!megaPages.some(p => p.megaMenu === 'asesorias' && ASESORIAS.some(a => a.slug === p.slug))) return html
  if (/id="nfd-asesorias"/.test(html) || /data-mega-group="asesorias"/.test(html)) return html
  const chevron = '<svg class="comp-nfd-chevron" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1.5 3.5 5 7 8.5 3.5"></polyline></svg>'
  const script = '<script>(function(){var li=document.currentScript.parentElement;var btn=li.querySelector(".comp-nfd-trigger");var t=null;function open(v){li.setAttribute("data-open",v?"true":"false");btn.setAttribute("aria-expanded",String(v));}open(false);btn.addEventListener("click",function(e){e.stopPropagation();clearTimeout(t);var href=btn.getAttribute("data-href");if(href&&window.matchMedia("(min-width:641px)").matches){window.location.href=href;}else{open(li.getAttribute("data-open")!=="true");}});li.addEventListener("mouseenter",function(){if(window.matchMedia("(min-width:641px)").matches){clearTimeout(t);open(true);}});li.addEventListener("mouseleave",function(){if(window.matchMedia("(min-width:641px)").matches){t=setTimeout(function(){open(false);},180);}});document.addEventListener("click",function(e){if(!li.contains(e.target)){clearTimeout(t);open(false);}});document.addEventListener("keydown",function(e){if(e.key==="Escape"){clearTimeout(t);open(false);}});})();</script>'
  const li = `<li class="comp-nfd" data-comp="nav-feature-dropdown" data-open="false" data-mega-group="asesorias"><button type="button" class="comp-nfd-trigger" data-href="./${ASES_HUB}" aria-expanded="false" aria-controls="nfd-asesorias" aria-haspopup="menu">Asesorías${chevron}</button><div class="comp-nfd-panel" id="nfd-asesorias" role="menu" data-mega-group="asesorias"></div>${script}</li>`
  // Anchor: the <li> holding the Funcionalidades trigger (fallback: Comparativas, Recursos, end of the first nav <ul>).
  const triggerIdx = (() => {
    for (const re of [/<button[^>]*class="comp-nfd-trigger"[^>]*>\s*Funcionalidades/, /<button[^>]*class="comp-nfd-trigger"[^>]*>\s*Comparativas/, /<button[^>]*class="comp-nfd-trigger"[^>]*>\s*Recursos/]) {
      const m = re.exec(html); if (m) return m.index
    }
    return -1
  })()
  if (triggerIdx !== -1) {
    const liStart = html.lastIndexOf('<li', triggerIdx)
    if (liStart !== -1) return html.slice(0, liStart) + li + html.slice(liStart)
  }
  const navStart = html.search(/<nav[\s>]/i)
  if (navStart === -1) return html
  const ulEnd = html.indexOf('</ul>', navStart)
  return ulEnd === -1 ? html : html.slice(0, ulEnd) + li + html.slice(ulEnd)
}
