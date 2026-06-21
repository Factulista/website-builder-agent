/**
 * POST /api/internal/inject-funcionalidades-faqs
 * Injects topic-specific FAQ sections (HTML + CSS + FAQPage JSON-LD) into each
 * funcionalidades page that has a wrong or missing FAQ.
 * Also fixes the <title> double-prefix bug on control-de-pagos-y-cobros.
 * Safe to run multiple times — replaces existing .faq section if found.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const CHEVRON_SVG = `<svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`

const FAQ_CSS = `<style id="faq-styles">
    .faq { background: var(--surface); padding: 96px 40px; }
    .faq .container { max-width: 1120px; margin: 0 auto; }
    .faq .section-header { margin-bottom: 56px; text-align: center; }
    .faq .section-header .section-sub { margin: 0 auto; }
    .faq-grid { display: grid; grid-template-columns: 1fr; gap: 14px; max-width: 800px; margin: 0 auto; }
    .faq-item { background: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden; }
    .faq-item.open { border-color: var(--accent); }
    .faq-trigger { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; background: transparent; border: none; cursor: pointer; text-align: left; font-family: inherit; font-size: 1rem; font-weight: 600; color: var(--text); transition: background 0.2s, color 0.2s; }
    .faq-trigger:hover { background: #f5f5f5; }
    .faq-item.open .faq-trigger { color: var(--accent); }
    .faq-chevron { flex-shrink: 0; width: 20px; height: 20px; transition: transform 0.25s; }
    .faq-item.open .faq-chevron { transform: rotate(180deg); }
    .faq-answer { padding: 0 24px 22px; color: var(--text-mid); line-height: 1.75; font-size: 0.97rem; }
    .faq-answer p { margin: 0; }
    @media (max-width: 640px) { .faq { padding: 64px 20px; } }
  </style>`

const FAQ_JS = `<script>
  (function(){
    document.querySelectorAll('.faq-trigger').forEach(function(btn){
      btn.addEventListener('click', function(){
        var item = btn.closest('.faq-item');
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item').forEach(function(i){ i.classList.remove('open'); i.querySelector('.faq-answer').style.display='none'; });
        if(!isOpen){ item.classList.add('open'); item.querySelector('.faq-answer').style.display='block'; }
      });
    });
  })();
</script>`

function faqItem(q: string, a: string, open = false) {
  return `<div class="faq-item${open ? ' open' : ''}">
          <button class="faq-trigger" aria-expanded="${open}">
            <span class="faq-question">${q}</span>
            ${CHEVRON_SVG}
          </button>
          <div class="faq-answer" style="display:${open ? 'block' : 'none'};">
            <p>${a}</p>
          </div>
        </div>`
}

function faqSection(title: string, subtitle: string, items: Array<[string, string]>) {
  const itemsHtml = items.map((([q, a], i) => faqItem(q, a, i === 0))).join('\n        ')
  return `${FAQ_CSS}
  <section class="faq" id="faqs">
    <div class="container">
      <div class="section-header center">
        <span class="section-label">PREGUNTAS FRECUENTES</span>
        <h2 class="section-title">${title}</h2>
        <p class="section-sub">${subtitle}</p>
      </div>
      <div class="faq-grid">
        ${itemsHtml}
      </div>
    </div>
  </section>
  ${FAQ_JS}`
}

function faqJsonLd(items: Array<[string, string]>) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    ${items.map(([q, a]) => `{
      "@type": "Question",
      "name": ${JSON.stringify(q)},
      "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(a.replace(/<[^>]+>/g, ''))} }
    }`).join(',\n    ')}
  ]
}
</script>`
}

const PAGES: Record<string, { title: string; subtitle: string; items: Array<[string, string]> }> = {
  'control-de-pagos-y-cobros': {
    title: 'Todo lo que necesitas saber sobre control de pagos y cobros',
    subtitle: 'Resolvemos tus dudas sobre tesorería, seguimiento de cobros y gestión de pagos con Factulista.',
    items: [
      ['¿Cómo registro el cobro de una factura en Factulista?', 'Desde el listado de facturas, haz clic en la factura y selecciona "Marcar como cobrada". Puedes indicar la fecha de cobro, el importe parcial o total y el método de pago. El estado de la factura se actualiza al instante y queda reflejado en tu cuadro de tesorería.'],
      ['¿Puedo hacer seguimiento de facturas pendientes de cobro?', 'Sí. El panel de tesorería muestra todas las facturas pendientes, su fecha de vencimiento y el importe total por cobrar. Puedes filtrar por cliente, período o estado (vencida, por vencer, parcialmente cobrada) para tener siempre una visión clara de tu liquidez.'],
      ['¿Cómo gestiono los pagos a mis proveedores?', 'Factulista te permite registrar facturas recibidas de proveedores y marcarlas como pagadas cuando realices la transferencia. El sistema cruza automáticamente ingresos y gastos para ofrecerte un saldo de tesorería actualizado en tiempo real.'],
      ['¿Puedo conciliar mis movimientos bancarios con mis facturas?', 'Puedes importar los movimientos de tu banco en formato CSV y Factulista los sugiere automáticamente para conciliarlos con tus facturas emitidas y recibidas, reduciendo el trabajo manual de cuadrar las cuentas.'],
      ['¿Factulista me avisa cuando una factura está próxima a vencer?', 'Sí. Puedes activar recordatorios automáticos de cobro: Factulista envía un email a tu cliente cuando la factura está a punto de vencer o lleva días vencida. Tú decides el número de días y la frecuencia de los avisos.'],
      ['¿Puedo ver un informe de flujo de caja o cash-flow?', 'Desde la sección de informes tienes acceso al informe de flujo de caja con ingresos, gastos y saldo proyectado. Puedes filtrarlo por período y exportarlo a PDF o Excel para compartirlo con tu asesor o analizar tendencias de liquidez.'],
    ],
  },
  'gestion-de-facturas-recibidas-y-gastos': {
    title: 'Todo lo que necesitas saber sobre facturas recibidas y gastos',
    subtitle: 'Resolvemos tus dudas sobre cómo registrar, organizar y deducir tus compras y gastos con Factulista.',
    items: [
      ['¿Cómo registro una factura de proveedor en Factulista?', 'Ve a la sección "Facturas recibidas", haz clic en "Nueva factura recibida" e introduce los datos del proveedor, importe, IVA y fecha. Si tienes el PDF, puedes adjuntarlo directamente para tenerlo todo en un solo lugar. La factura queda guardada y lista para el cálculo de tu IVA deducible.'],
      ['¿Puedo digitalizar tickets y justificantes de gasto desde el móvil?', 'Sí. Factulista tiene captura de tickets desde la app: haz una foto al justificante y el sistema extrae automáticamente el importe, la fecha y el proveedor mediante OCR. Los tickets digitalizados quedan vinculados a tu registro de gastos y son válidos para Hacienda.'],
      ['¿Cómo afectan las facturas recibidas a mi declaración del IVA?', 'Cada factura recibida con IVA que registres en Factulista suma al IVA soportado. Cuando llegue la declaración del modelo 303, Factulista calcula automáticamente la diferencia entre el IVA repercutido (de tus ventas) y el soportado (de tus compras), indicándote si tienes que ingresar o si Hacienda te debe devolver.'],
      ['¿Puedo categorizar los gastos para que cuadren con mis impuestos?', 'Sí. Puedes asignar a cada gasto una categoría contable: suministros, servicios profesionales, alquiler, material de oficina, etc. Factulista agrupa los gastos por categoría en tus informes, facilitando la preparación de los modelos fiscales junto a tu asesor.'],
      ['¿Factulista me ayuda a preparar el modelo 303 de IVA?', 'Factulista genera automáticamente el resumen de IVA repercutido y soportado por trimestre. Con un solo clic tienes los datos del modelo 303 listos para revisarlos o enviarlos a tu asesor fiscal, sin necesidad de sumar manualmente ninguna factura.'],
      ['¿Puedo importar facturas de proveedores habituales de forma masiva?', 'Sí, puedes importar facturas recibidas en bloque desde un fichero CSV o conectar con tus proveedores para recibir facturas electrónicas directamente. Para proveedores recurrentes puedes guardar sus datos y reutilizarlos en futuros registros con un solo clic.'],
    ],
  },
  'informes-avanzados': {
    title: 'Todo lo que necesitas saber sobre informes y analítica financiera',
    subtitle: 'Resolvemos tus dudas sobre dashboards, exportaciones e informes fiscales en Factulista.',
    items: [
      ['¿Qué informes financieros puedo generar con Factulista?', 'Factulista incluye informes de facturación por período, flujo de caja, IVA repercutido y soportado, rentabilidad por cliente, gastos por categoría, y comparativas anuales. Todos se generan en tiempo real con los datos de tu cuenta, sin necesidad de exportar ni cruzar información manualmente.'],
      ['¿Puedo exportar los informes a Excel o PDF?', 'Sí. Todos los informes de Factulista tienen opción de exportar a PDF (para compartir o archivar) y a Excel o CSV (para trabajar los datos con tu asesor o en tus propias hojas de cálculo). La exportación conserva los filtros aplicados —período, cliente, categoría— para que obtengas exactamente lo que necesitas.'],
      ['¿Con qué frecuencia se actualizan los datos del dashboard?', 'El dashboard se actualiza en tiempo real: cada vez que emites una factura, registras un cobro o añades un gasto, los indicadores —facturación total, facturas pendientes, IVA, saldo de tesorería— reflejan el nuevo estado al instante, sin necesidad de refrescar manualmente.'],
      ['¿Puedo ver la rentabilidad por cliente o proyecto?', 'Sí. El informe de rentabilidad por cliente muestra cuánto has facturado, cuánto has cobrado y los gastos asociados a cada cliente o proyecto. Esto te permite identificar qué clientes son más rentables y tomar decisiones basadas en datos reales.'],
      ['¿Los informes me ayudan a preparar las declaraciones fiscales trimestrales?', 'Factulista genera el resumen de IVA (modelo 303), el resumen de retenciones (modelo 111/115) y el listado de operaciones con terceros (modelo 347) con todos los datos pre-calculados. Puedes enviárselos directamente a tu asesor o revisarlos tú mismo antes de presentarlos a Hacienda.'],
      ['¿Puedo compartir informes con mi asesor fiscal sin darle acceso a toda la cuenta?', 'Sí. Puedes invitar a tu asesor fiscal con un rol de "solo lectura" para que acceda a los informes y datos sin poder modificar nada. También puedes exportar y enviar los informes en PDF o Excel sin necesidad de dar acceso a la plataforma.'],
    ],
  },
  'gestion-de-clientes-y-proveedores': {
    title: 'Todo lo que necesitas saber sobre gestión de clientes y proveedores',
    subtitle: 'Resolvemos tus dudas sobre el CRM, historial de contactos y condiciones de pago en Factulista.',
    items: [
      ['¿Puedo importar mis clientes existentes desde Excel o CSV?', 'Sí. Factulista permite importar clientes y proveedores en bloque desde un fichero CSV o Excel. Solo tienes que preparar el fichero con las columnas básicas (nombre, NIF, email, dirección) y el sistema los importa en segundos, sin tener que crearlos uno a uno.'],
      ['¿Cómo veo el historial completo de facturas de un cliente?', 'Desde la ficha de cada cliente tienes acceso a todo su historial: facturas emitidas, presupuestos enviados, cobros realizados, facturas vencidas y saldo pendiente. Puedes filtrar por período o estado para encontrar cualquier documento en segundos.'],
      ['¿Puedo asignar condiciones de pago diferentes a cada cliente?', 'Sí. En la ficha de cliente puedes establecer la forma de pago habitual (transferencia, domiciliación, tarjeta), el plazo de vencimiento (30, 60, 90 días…) y el descuento comercial por defecto. Estos valores se aplican automáticamente cada vez que creas una factura para ese cliente.'],
      ['¿Factulista tiene portal para que los clientes descarguen sus facturas?', 'Sí. Puedes enviar a tus clientes un enlace a su portal privado donde pueden ver y descargar todas las facturas que les has emitido, consultar el estado de sus pagos y actualizar sus datos de contacto. Esto reduce las consultas por email y mejora la experiencia del cliente.'],
      ['¿Puedo gestionar varios proveedores con distintas formas de pago?', 'Cada proveedor tiene su propia ficha con forma de pago, número de cuenta, plazo de pago y datos fiscales. Cuando registras una factura recibida de ese proveedor, Factulista pre-rellena automáticamente todos sus datos, reduciendo el tiempo de entrada a segundos.'],
      ['¿Es posible segmentar clientes por categoría o etiquetas?', 'Sí. Puedes asignar etiquetas personalizadas a tus clientes —por sector, tamaño, origen, producto contratado— para segmentarlos y filtrar rápidamente tus informes de facturación o enviar comunicaciones dirigidas a un grupo concreto.'],
    ],
  },
  'cumplimiento-normativo': {
    title: 'Todo lo que necesitas saber sobre cumplimiento fiscal y normativo',
    subtitle: 'Resolvemos tus dudas sobre VeriFactu, RGPD, seguridad y actualizaciones normativas en Factulista.',
    items: [
      ['¿Está Factulista adaptado para VeriFactu según el RD 1007/2023?', 'Sí. Factulista cumple con los requisitos técnicos del Real Decreto 1007/2023. Genera el registro de facturación con huella digital (hash encadenado), firma electrónica y código QR en cada factura, tal y como exige la AEAT. Puedes elegir el modo "VeriFactu SÍ" para envío automático o "VeriFactu NO" para conservar los registros internamente sin conexión con Hacienda.'],
      ['¿Cómo cumple Factulista con el Reglamento de Facturación Electrónica (RD 1619/2012)?', 'Factulista genera facturas con todos los campos obligatorios del RD 1619/2012: número correlativo, fecha de expedición, datos del emisor y receptor, descripción de los bienes o servicios, base imponible, tipo y cuota de IVA y, cuando procede, retención de IRPF. Las facturas son inmutables una vez emitidas y quedan archivadas de forma segura.'],
      ['¿Qué pasa si Hacienda hace una inspección? ¿Están mis datos protegidos?', 'Factulista conserva todas tus facturas y registros fiscales durante el plazo legal (mínimo 4 años, 10 años para ciertos documentos). En caso de inspección, puedes exportar en segundos todos los libros de registro en formato oficial. Nuestros servidores están en la UE, con copias de seguridad automáticas y cifrado de datos en tránsito y en reposo.'],
      ['¿Se actualiza Factulista automáticamente cuando cambia la normativa?', 'Sí. Nuestro equipo monitoriza continuamente los cambios normativos publicados por la AEAT y el BOE. Cuando hay una actualización relevante —nuevos tipos de IVA, cambios en la factura electrónica, nuevos modelos fiscales— Factulista se actualiza automáticamente sin que tengas que hacer nada.'],
      ['¿Factulista cumple con el RGPD y la LOPD-GDD?', 'Sí. Factulista actúa como encargado del tratamiento de los datos de tus clientes y proveedores con total transparencia. Firmamos un Acuerdo de Encargo del Tratamiento (DPA), tus datos no se venden ni se comparten con terceros no autorizados, y puedes exportar o eliminar todos tus datos en cualquier momento desde tu cuenta.'],
      ['¿Puedo obtener documentación de cumplimiento para mi asesor o una auditoría?', 'Sí. Desde tu cuenta puedes descargar el informe de auditoría de actividad, el registro de operaciones, los libros de facturas emitidas y recibidas en formato oficial, y el DPA firmado. Esta documentación es suficiente para acreditar el cumplimiento ante inspecciones, auditorías o concursos públicos.'],
    ],
  },
}

function injectFaqIntoPage(html: string, slug: string): string {
  const config = PAGES[slug]
  if (!config) return html

  const { title, subtitle, items } = config
  const sectionHtml = faqSection(title, subtitle, items)
  const ldJson = faqJsonLd(items)

  // Remove existing FAQ section (may be wrong/generic)
  let result = html.replace(/<style id="faq-styles">[\s\S]*?<\/style>\s*/g, '')
  result = result.replace(/<section[^>]*class="faq"[^>]*>[\s\S]*?<\/section>\s*/g, '')
  result = result.replace(/<script[^>]*>[\s\S]*?\.faq-trigger[\s\S]*?<\/script>/g, '')

  // Remove existing FAQPage JSON-LD
  result = result.replace(/<script type="application\/ld\+json">\s*\{[\s\S]*?"@type"\s*:\s*"FAQPage"[\s\S]*?<\/script>/g, '')

  // Inject FAQ section before </body> (before shared footer)
  if (result.includes('<footer') || result.includes('class="footer"')) {
    result = result.replace(/(<footer|<div[^>]+class="[^"]*footer[^"]*")/, `${sectionHtml}\n  $1`)
  } else {
    result = result.replace('</body>', `${sectionHtml}\n</body>`)
  }

  // Fix double-title bug: "Factulista | Factulista | X" → "X | Factulista"
  result = result.replace(/<title>Factulista \| Factulista \|([^<]+)<\/title>/, '<title>$1 | Factulista</title>')

  // Inject FAQPage JSON-LD before </head>
  result = result.replace('</head>', `${ldJson}\n</head>`)

  return result
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const projectId = (body?.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const slugs = Object.keys(PAGES)
  const results: Record<string, string> = {}

  const applyToList = (list: Array<Record<string, unknown>>) =>
    list.map(p => {
      const slug = p.slug as string
      if (!slugs.includes(slug)) return p
      const newHtml = injectFaqIntoPage(p.html as string, slug)
      results[slug] = newHtml !== p.html ? 'updated' : 'unchanged'
      return { ...p, html: newHtml }
    })

  const pages = applyToList((cfg.pages as Array<Record<string, unknown>>) ?? [])
  const published = applyToList((cfg.published_pages as Array<Record<string, unknown>>) ?? [])

  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...cfg, pages, published_pages: published },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
  return NextResponse.json({ message: 'FAQ injection complete', results })
}
