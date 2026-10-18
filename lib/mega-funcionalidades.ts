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
