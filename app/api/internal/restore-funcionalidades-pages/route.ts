/**
 * POST /api/internal/restore-funcionalidades-pages
 * Restores the 5 funcionalidades pages that were corrupted by the
 * inject-funcionalidades-faqs endpoint (it accidentally removed all
 * page content except the FAQ section).
 *
 * Strategy:
 *  1. Read the INTACT facturacion-verifactu page HTML from published_pages
 *  2. For each broken page, build a full-page HTML by replacing:
 *       - <title> / <meta description>
 *       - hero section content
 *       - all 5 alt-sections content
 *       - cta-banner text
 *       - faq section (with the topic-specific FAQ already in inject endpoint)
 *  3. Save to both pages and published_pages
 *
 * Run once: POST https://app.factulista.com/api/internal/restore-funcionalidades-pages
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const runtime = 'nodejs'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const ARROW_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"></path></svg>`
const CHEVRON_SVG = `<svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`

function checkItem(color: string, text: string) {
  const colors: Record<string, string> = {
    blue: 'background: rgb(219, 234, 254); color: rgb(37, 99, 235);',
    green: 'background: #d1fae5; color: #059669;',
    amber: 'background: rgb(254, 243, 199); color: rgb(217, 119, 6);',
    purple: 'background: #e9d5ff; color: #7c3aed;',
    cyan: 'background: rgb(207, 250, 254); color: rgb(8, 145, 178);',
  }
  return `<li><span class="check-icon" style="${colors[color] ?? colors.blue}">✓</span> <span>${text}</span></li>`
}

function altSectionTextLeft(label: string, labelStyle: string, h2: string, p: string, items: string[], btnColor: string, btnText: string, imgBadge: string, imgSrc: string, imgAlt: string, imgBg: string) {
  return `<section class="alt-section">
    <div class="alt-grid">
      <div class="alt-text">
        <span class="section-label" style="${labelStyle}">${label}</span>
        <h2>${h2}</h2>
        <p>${p}</p>
        <ul>${items.join('')}</ul>
        <a href="https://app.factulista.com/registro" class="btn-primary" target="_blank" rel="noopener noreferrer" style="background: ${btnColor};">
          ${btnText}${ARROW_SVG}
        </a>
      </div>
      <div class="alt-image">
        <span class="img-badge">${imgBadge}</span>
        <img src="${imgSrc}" alt="${imgAlt}" style="background: ${imgBg}; object-fit: cover;">
      </div>
    </div>
  </section>`
}

function altSectionImageLeft(label: string, labelStyle: string, h2: string, p: string, items: string[], btnColor: string, btnText: string, imgBadge: string, imgSrc: string, imgAlt: string, imgBg: string) {
  return `<section class="alt-section">
    <div class="alt-grid">
      <div class="alt-image">
        <span class="img-badge">${imgBadge}</span>
        <img src="${imgSrc}" alt="${imgAlt}" style="background: ${imgBg}; object-fit: cover;">
      </div>
      <div class="alt-text">
        <span class="section-label" style="${labelStyle}">${label}</span>
        <h2>${h2}</h2>
        <p>${p}</p>
        <ul>${items.join('')}</ul>
        <a href="https://app.factulista.com/registro" class="btn-primary" target="_blank" rel="noopener noreferrer" style="background: ${btnColor};">
          ${btnText}${ARROW_SVG}
        </a>
      </div>
    </div>
  </section>`
}

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

// Image URLs from Supabase storage (reuse verifactu screenshots — generic product UI)
const IMG = [
  'https://xjtnbpqmkobyqfhdknhm.supabase.co/storage/v1/object/public/project-assets/9be2f927-4bf7-45cf-b737-6b6d7e66bc8a/6a436817-7c0a-40ed-aa26-8aeffdc128f4/1781670751384.png',
  'https://xjtnbpqmkobyqfhdknhm.supabase.co/storage/v1/object/public/project-assets/9be2f927-4bf7-45cf-b737-6b6d7e66bc8a/6a436817-7c0a-40ed-aa26-8aeffdc128f4/1781671628328.png',
  'https://xjtnbpqmkobyqfhdknhm.supabase.co/storage/v1/object/public/project-assets/9be2f927-4bf7-45cf-b737-6b6d7e66bc8a/6a436817-7c0a-40ed-aa26-8aeffdc128f4/1781672629212.png',
  'https://xjtnbpqmkobyqfhdknhm.supabase.co/storage/v1/object/public/project-assets/9be2f927-4bf7-45cf-b737-6b6d7e66bc8a/6a436817-7c0a-40ed-aa26-8aeffdc128f4/1781673230386.png',
  'https://xjtnbpqmkobyqfhdknhm.supabase.co/storage/v1/object/public/project-assets/9be2f927-4bf7-45cf-b737-6b6d7e66bc8a/6a436817-7c0a-40ed-aa26-8aeffdc128f4/1781717821699.png',
]

interface PageDef {
  title: string
  description: string
  heroBadge: string
  heroH1: string
  heroSub: string
  sections: ReturnType<typeof buildSections>
  ctaH2: string
  ctaP: string
  faqTitle: string
  faqSubtitle: string
  faqs: Array<[string, string]>
}

function buildSections(slug: string): string {
  if (slug === 'control-de-pagos-y-cobros') {
    return [
      altSectionTextLeft('TESORERÍA EN TIEMPO REAL', 'background: rgb(219, 234, 254); color: rgb(37, 99, 235); border: 1px solid rgb(37, 99, 235); padding: 6px 16px;',
        'Ve de un vistazo todo lo que entra y lo que sale de tu negocio',
        'El panel de tesorería de Factulista muestra tu saldo actualizado al instante. Consulta las facturas cobradas, las pendientes, las próximas a vencer y tu cash-flow proyectado, sin salir de la pantalla.',
        [checkItem('blue','Saldo de tesorería actualizado en tiempo real'), checkItem('blue','Facturas cobradas, pendientes y vencidas en un solo panel'), checkItem('blue','Cash-flow proyectado semana a semana')],
        'rgb(37, 99, 235)', 'Ver mi tesorería', 'TIEMPO REAL', IMG[0], 'Panel de tesorería Factulista', '#dbeafe'),
      altSectionImageLeft('SEGUIMIENTO DE COBROS', 'background: #d1fae5; color: #059669; border: 1px solid #059669; padding: 6px 16px;',
        'Registra cada cobro en segundos y marca las facturas como pagadas',
        'Cuando tu cliente paga, accede a la factura y haz clic en "Marcar como cobrada". Puedes indicar el importe parcial o total y la fecha exacta de cobro. Todo queda reflejado en tu panel de tesorería al instante.',
        [checkItem('green','Cobros parciales o totales con fecha y método de pago'), checkItem('green','Estado de cada factura visible desde el listado principal'), checkItem('green','Historial de cobros exportable a Excel o PDF')],
        '#059669', 'Registrar mis cobros', 'COBROS', IMG[1], 'Seguimiento de cobros en Factulista', '#d1fae5'),
      altSectionTextLeft('SIN IMPAGOS', 'background: rgb(254, 243, 199); color: rgb(217, 119, 6); border: 1px solid rgb(217, 119, 6); padding: 6px 16px;',
        'Deja de perseguir a tus clientes: los recordatorios llegan solos',
        'Factulista envía automáticamente un email a tu cliente cuando una factura está próxima a vencer o lleva días sin pagarse. Tú decides cuándo y cuántas veces se avisa. Sin llamadas incómodas, sin olvidar ningún impago.',
        [checkItem('amber','Recordatorios automáticos por email antes y después del vencimiento'), checkItem('amber','Configura el número de avisos y la frecuencia'), checkItem('amber','Dashboard de facturas vencidas con acceso directo a la acción')],
        'rgb(217, 119, 6)', 'Activar recordatorios', 'SIN OLVIDOS', IMG[2], 'Recordatorios de cobro automáticos', '#fef3c7'),
      altSectionImageLeft('CONCILIACIÓN BANCARIA', 'background: #e9d5ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 16px;',
        'Importa tus movimientos bancarios y cruza con tus facturas en segundos',
        'Sube el extracto de tu banco en formato CSV y Factulista sugiere automáticamente qué movimiento corresponde a cada factura. Menos trabajo manual, menos errores, cuentas siempre cuadradas.',
        [checkItem('purple','Importación de movimientos bancarios en formato CSV'), checkItem('purple','Sugerencias automáticas de conciliación'), checkItem('purple','Control del saldo conciliado vs. pendiente en tiempo real')],
        '#7c3aed', 'Conciliar mi banco', 'BANCO', IMG[3], 'Conciliación bancaria en Factulista', '#e9d5ff'),
      altSectionTextLeft('INFORMES DE TESORERÍA', 'background: rgb(207, 250, 254); color: rgb(8, 145, 178); border: 1px solid rgb(8, 145, 178); padding: 6px 16px;',
        'Exporta tu informe de flujo de caja y compártelo con tu asesor',
        'Accede al informe de cash-flow con ingresos, gastos y saldo proyectado para el período que necesites. Exporta en PDF o Excel con un clic y envíalo directamente a tu asesor fiscal o analiza tendencias por tu cuenta.',
        [checkItem('cyan','Informe de cash-flow filtrable por período y categoría'), checkItem('cyan','Exportación a PDF y Excel en un clic'), checkItem('cyan','Gráfico de flujo de caja mensual y anual')],
        'rgb(8, 145, 178)', 'Ver mis informes', 'EXPORTA', IMG[4], 'Informe de flujo de caja Factulista', '#cffafe'),
    ].join('\n')
  }

  if (slug === 'gestion-de-facturas-recibidas-y-gastos') {
    return [
      altSectionTextLeft('REGISTRO DE GASTOS', 'background: rgb(219, 234, 254); color: rgb(37, 99, 235); border: 1px solid rgb(37, 99, 235); padding: 6px 16px;',
        'Registra cada gasto en segundos con todos los datos para Hacienda',
        'Introduce el proveedor, el importe, el IVA y la fecha. Adjunta el PDF de la factura para tenerlo todo en un solo lugar. Factulista calcula automáticamente el IVA soportado deducible y lo suma a tu resumen trimestral.',
        [checkItem('blue','Registro completo con proveedor, importe, IVA y fecha'), checkItem('blue','Adjunta el PDF de la factura directamente al gasto'), checkItem('blue','IVA soportado acumulado calculado automáticamente')],
        'rgb(37, 99, 235)', 'Registrar mis gastos', 'IVA DEDUCIBLE', IMG[0], 'Registro de facturas recibidas en Factulista', '#dbeafe'),
      altSectionImageLeft('DIGITALIZACIÓN', 'background: #d1fae5; color: #059669; border: 1px solid #059669; padding: 6px 16px;',
        'Digitaliza tickets con el móvil y olvídate del papel para siempre',
        'Fotografía cualquier ticket o justificante de gasto desde la app. Factulista extrae automáticamente el importe, la fecha y el proveedor mediante OCR. Los tickets digitalizados son válidos para Hacienda y quedan vinculados a tu registro de gastos.',
        [checkItem('green','Captura de tickets con cámara del móvil'), checkItem('green','Extracción automática de datos por OCR'), checkItem('green','Tickets válidos para Hacienda según normativa vigente')],
        '#059669', 'Digitalizar mis tickets', 'OCR', IMG[1], 'Digitalización de tickets en Factulista', '#d1fae5'),
      altSectionTextLeft('CATEGORIZACIÓN', 'background: rgb(254, 243, 199); color: rgb(217, 119, 6); border: 1px solid rgb(217, 119, 6); padding: 6px 16px;',
        'Clasifica cada gasto por categoría y que tu asesor solo revise, no busque',
        'Asigna a cada gasto una categoría contable: suministros, servicios profesionales, alquiler, material de oficina, publicidad… Factulista agrupa los gastos en tus informes y facilita la preparación de los modelos fiscales junto a tu asesor.',
        [checkItem('amber','Categorías contables predefinidas y personalizables'), checkItem('amber','Informes de gasto por categoría y período'), checkItem('amber','Exportación para presentar junto al asesor fiscal')],
        'rgb(217, 119, 6)', 'Categorizar mis gastos', 'CATEGORÍAS', IMG[2], 'Categorización de gastos en Factulista', '#fef3c7'),
      altSectionImageLeft('MODELO 303', 'background: #e9d5ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 16px;',
        'Tu declaración de IVA lista en un clic, sin sumar ni una factura',
        'Factulista calcula automáticamente el IVA repercutido (facturas emitidas) y el IVA soportado (facturas recibidas). Al final del trimestre tienes el resumen del modelo 303 listo para enviarlo a tu asesor o presentarlo directamente.',
        [checkItem('purple','Cálculo automático de IVA repercutido y soportado'), checkItem('purple','Resumen del modelo 303 por trimestre'), checkItem('purple','Exportación del libro de facturas recibidas')],
        '#7c3aed', 'Ver mi resumen de IVA', 'MODELO 303', IMG[3], 'Resumen IVA modelo 303 en Factulista', '#e9d5ff'),
      altSectionTextLeft('IMPORTACIÓN MASIVA', 'background: rgb(207, 250, 254); color: rgb(8, 145, 178); border: 1px solid rgb(8, 145, 178); padding: 6px 16px;',
        'Importa en bloque y guarda proveedores para no repetir datos nunca más',
        'Sube un fichero CSV con todas tus facturas recibidas para importarlas de golpe. Para los proveedores habituales, guarda sus datos una vez y reutilízalos en futuros gastos con un solo clic. Sin introducir el mismo proveedor dos veces.',
        [checkItem('cyan','Importación masiva de facturas recibidas por CSV'), checkItem('cyan','Proveedores guardados y reutilizables'), checkItem('cyan','Historial completo de compras por proveedor')],
        'rgb(8, 145, 178)', 'Importar mis gastos', 'IMPORTA', IMG[4], 'Importación masiva de facturas en Factulista', '#cffafe'),
    ].join('\n')
  }

  if (slug === 'informes-avanzados') {
    return [
      altSectionTextLeft('DASHBOARD EN TIEMPO REAL', 'background: rgb(219, 234, 254); color: rgb(37, 99, 235); border: 1px solid rgb(37, 99, 235); padding: 6px 16px;',
        'Todos tus KPIs financieros en una sola pantalla, siempre al día',
        'El dashboard de Factulista muestra la facturación total, las facturas pendientes de cobro, el IVA acumulado y el saldo de tesorería. Se actualiza en tiempo real con cada factura que emites o gasto que registras. Sin esperar, sin cálculos manuales.',
        [checkItem('blue','Facturación total, cobros pendientes y saldo de tesorería al instante'), checkItem('blue','Actualización en tiempo real con cada operación'), checkItem('blue','Resumen de IVA repercutido y soportado por trimestre')],
        'rgb(37, 99, 235)', 'Ver mi dashboard', 'TIEMPO REAL', IMG[0], 'Dashboard financiero Factulista', '#dbeafe'),
      altSectionImageLeft('EXPORTACIÓN', 'background: #d1fae5; color: #059669; border: 1px solid #059669; padding: 6px 16px;',
        'Exporta cualquier informe a PDF o Excel con un solo clic',
        'Todos los informes de Factulista se pueden exportar a PDF para compartir o archivar, o a Excel/CSV para trabajar los datos con tu asesor. La exportación conserva los filtros aplicados —período, cliente, categoría— para que obtengas exactamente lo que necesitas.',
        [checkItem('green','Exportación a PDF, Excel y CSV disponible en todos los informes'), checkItem('green','Filtros aplicados conservados en la exportación'), checkItem('green','Compatible con cualquier asesor fiscal o herramienta contable')],
        '#059669', 'Exportar mis informes', 'EXPORTA', IMG[1], 'Exportación de informes a PDF y Excel en Factulista', '#d1fae5'),
      altSectionTextLeft('RENTABILIDAD POR CLIENTE', 'background: rgb(254, 243, 199); color: rgb(217, 119, 6); border: 1px solid rgb(217, 119, 6); padding: 6px 16px;',
        'Descubre qué clientes te generan más y cuáles te cuestan más',
        'El informe de rentabilidad por cliente muestra cuánto has facturado, cuánto has cobrado y los gastos asociados a cada cliente o proyecto. Identifica de un vistazo tus clientes más rentables y decide dónde poner el foco.',
        [checkItem('amber','Facturación, cobros y gastos por cliente o proyecto'), checkItem('amber','Comparativa de períodos para detectar tendencias'), checkItem('amber','Ranking de clientes por facturación e ingresos reales')],
        'rgb(217, 119, 6)', 'Ver rentabilidad por cliente', 'POR CLIENTE', IMG[2], 'Informe de rentabilidad por cliente en Factulista', '#fef3c7'),
      altSectionImageLeft('INFORMES FISCALES', 'background: #e9d5ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 16px;',
        'Tus modelos fiscales trimestrales listos sin calcular nada',
        'Factulista genera el resumen de IVA (modelo 303), las retenciones (modelos 111/115) y el listado de operaciones con terceros (modelo 347) con todos los datos pre-calculados. Envíaselos directamente a tu asesor o revísalos tú antes de presentarlos.',
        [checkItem('purple','Resumen modelo 303 de IVA por trimestre'), checkItem('purple','Datos para modelos 111/115 de retenciones IRPF'), checkItem('purple','Listado para modelo 347 de operaciones con terceros')],
        '#7c3aed', 'Ver mis informes fiscales', 'MODELOS', IMG[3], 'Informes fiscales trimestrales en Factulista', '#e9d5ff'),
      altSectionTextLeft('COMPARTIR CON TU ASESOR', 'background: rgb(207, 250, 254); color: rgb(8, 145, 178); border: 1px solid rgb(8, 145, 178); padding: 6px 16px;',
        'Dale acceso a tu asesor sin que pueda tocar nada que no deba',
        'Invita a tu asesor fiscal con un rol de solo lectura para que acceda a los informes y datos sin poder modificar nada. También puedes exportar y enviar los informes en PDF o Excel sin necesidad de dar acceso a la plataforma.',
        [checkItem('cyan','Rol de asesor con acceso de solo lectura'), checkItem('cyan','Exportación directa a PDF o Excel para enviar por email'), checkItem('cyan','Informes siempre actualizados, sin llamadas para pedir datos')],
        'rgb(8, 145, 178)', 'Invitar a mi asesor', 'ASESOR', IMG[4], 'Colaboración con asesor fiscal en Factulista', '#cffafe'),
    ].join('\n')
  }

  if (slug === 'gestion-de-clientes-y-proveedores') {
    return [
      altSectionTextLeft('IMPORTA TUS CONTACTOS', 'background: rgb(219, 234, 254); color: rgb(37, 99, 235); border: 1px solid rgb(37, 99, 235); padding: 6px 16px;',
        'Sube todos tus clientes de golpe desde Excel en menos de un minuto',
        'Factulista permite importar clientes y proveedores en bloque desde un fichero CSV o Excel. Prepara el fichero con las columnas básicas —nombre, NIF, email, dirección— y el sistema los importa en segundos, sin crearlos uno a uno.',
        [checkItem('blue','Importación masiva de clientes y proveedores desde CSV o Excel'), checkItem('blue','Validación automática de NIF y datos fiscales'), checkItem('blue','Acceso inmediato al listado completo una vez importado')],
        'rgb(37, 99, 235)', 'Importar mis clientes', 'IMPORTA', IMG[0], 'Importación de clientes en Factulista', '#dbeafe'),
      altSectionImageLeft('HISTORIAL COMPLETO', 'background: #d1fae5; color: #059669; border: 1px solid #059669; padding: 6px 16px;',
        'El historial completo de cada cliente a un clic, siempre organizado',
        'Desde la ficha de cada cliente tienes acceso a todo su historial: facturas emitidas, presupuestos enviados, cobros realizados, facturas vencidas y saldo pendiente. Filtra por período o estado para encontrar cualquier documento en segundos.',
        [checkItem('green','Historial de facturas, presupuestos y cobros por cliente'), checkItem('green','Filtros por período, estado y tipo de documento'), checkItem('green','Saldo total pendiente de cada cliente en tiempo real')],
        '#059669', 'Ver el historial de mis clientes', 'HISTORIAL', IMG[1], 'Historial de cliente en Factulista', '#d1fae5'),
      altSectionTextLeft('CONDICIONES DE PAGO', 'background: rgb(254, 243, 199); color: rgb(217, 119, 6); border: 1px solid rgb(217, 119, 6); padding: 6px 16px;',
        'Configura el plazo y forma de pago de cada cliente una vez y que se aplique siempre',
        'En la ficha de cliente puedes establecer la forma de pago habitual, el plazo de vencimiento y el descuento comercial por defecto. Estos valores se aplican automáticamente cada vez que creas una nueva factura para ese cliente.',
        [checkItem('amber','Forma de pago, plazo y descuento guardados por cliente'), checkItem('amber','Aplicación automática al crear nuevas facturas'), checkItem('amber','Historial de condiciones actualizado sin esfuerzo')],
        'rgb(217, 119, 6)', 'Configurar mis clientes', 'PERSONALIZADO', IMG[2], 'Condiciones de pago por cliente en Factulista', '#fef3c7'),
      altSectionImageLeft('PORTAL DEL CLIENTE', 'background: #e9d5ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 16px;',
        'Que tus clientes descarguen sus facturas sin llamarte nunca más',
        'Envía a tus clientes un enlace a su portal privado donde pueden ver y descargar todas las facturas que les has emitido, consultar el estado de sus pagos y actualizar sus datos de contacto. Menos emails, menos llamadas, más imagen profesional.',
        [checkItem('purple','Portal privado por cliente con acceso a sus facturas'), checkItem('purple','Descarga de documentos en PDF sin necesidad de cuenta'), checkItem('purple','Actualización de datos de contacto por parte del cliente')],
        '#7c3aed', 'Activar portal de clientes', 'PORTAL', IMG[3], 'Portal del cliente en Factulista', '#e9d5ff'),
      altSectionTextLeft('GESTIÓN DE PROVEEDORES', 'background: rgb(207, 250, 254); color: rgb(8, 145, 178); border: 1px solid rgb(8, 145, 178); padding: 6px 16px;',
        'Proveedores con ficha completa para no volver a buscar un dato dos veces',
        'Cada proveedor tiene su propia ficha con forma de pago, número de cuenta, plazo y datos fiscales. Al registrar una factura recibida de ese proveedor, Factulista pre-rellena todos sus datos automáticamente. Segmenta con etiquetas para filtrar rápido en tus informes.',
        [checkItem('cyan','Ficha de proveedor con datos fiscales, cuenta y plazos'), checkItem('cyan','Pre-rellenado automático al registrar facturas recibidas'), checkItem('cyan','Etiquetas y segmentación para filtrar rápido')],
        'rgb(8, 145, 178)', 'Gestionar mis proveedores', 'PROVEEDORES', IMG[4], 'Gestión de proveedores en Factulista', '#cffafe'),
    ].join('\n')
  }

  if (slug === 'cumplimiento-normativo') {
    return [
      altSectionTextLeft('VERIFACTU', 'background: rgb(219, 234, 254); color: rgb(37, 99, 235); border: 1px solid rgb(37, 99, 235); padding: 6px 16px;',
        'Cumple con VeriFactu desde el primer día sin entender de tecnicismos',
        'Factulista genera el registro de facturación con huella digital (hash encadenado), firma electrónica y código QR en cada factura, tal y como exige el Real Decreto 1007/2023. Elige el modo "VeriFactu SÍ" para envío automático a la AEAT o "VeriFactu NO" para conservar los registros internamente.',
        [checkItem('blue','Hash encadenado, firma electrónica y QR en cada factura'), checkItem('blue','Modo envío automático a AEAT o conservación interna'), checkItem('blue','Preparado para el plazo obligatorio del 1 de julio de 2027')],
        'rgb(37, 99, 235)', 'Activar VeriFactu', 'VERIFACTU', IMG[0], 'Cumplimiento VeriFactu en Factulista', '#dbeafe'),
      altSectionImageLeft('REGLAMENTO DE FACTURACIÓN', 'background: #d1fae5; color: #059669; border: 1px solid #059669; padding: 6px 16px;',
        'Facturas siempre conformes al RD 1619/2012 desde la primera que emites',
        'Factulista genera facturas con todos los campos obligatorios del Reglamento de Facturación: número correlativo, fecha, datos del emisor y receptor, descripción, base imponible, tipo y cuota de IVA y retención IRPF. Inmutables una vez emitidas y archivadas de forma segura.',
        [checkItem('green','Todos los campos obligatorios del RD 1619/2012 incluidos'), checkItem('green','Numeración correlativa automática por series'), checkItem('green','Facturas inmutables y archivadas con garantía legal')],
        '#059669', 'Emitir facturas legales', 'RD 1619/2012', IMG[1], 'Facturación conforme RD 1619/2012 en Factulista', '#d1fae5'),
      altSectionTextLeft('PROTECCIÓN ANTE INSPECCIONES', 'background: rgb(254, 243, 199); color: rgb(217, 119, 6); border: 1px solid rgb(217, 119, 6); padding: 6px 16px;',
        'Si llega una inspección, tienes todo exportado en segundos',
        'Factulista conserva todas tus facturas y registros durante el plazo legal (mínimo 4 años, 10 años para ciertos documentos). Exporta en segundos todos los libros de registro en formato oficial. Servidores en la UE, copias automáticas y cifrado en tránsito y en reposo.',
        [checkItem('amber','Conservación legal de facturas y registros (4-10 años)'), checkItem('amber','Exportación de libros de registro en formato oficial'), checkItem('amber','Datos cifrados en servidores europeos con backup automático')],
        'rgb(217, 119, 6)', 'Conocer las garantías legales', 'SEGURIDAD', IMG[2], 'Protección ante inspecciones en Factulista', '#fef3c7'),
      altSectionImageLeft('ACTUALIZACIÓN NORMATIVA', 'background: #e9d5ff; color: #7c3aed; border: 1px solid #7c3aed; padding: 6px 16px;',
        'Cambios normativos de la AEAT incorporados automáticamente, sin que hagas nada',
        'Nuestro equipo monitoriza continuamente los cambios publicados por la AEAT y el BOE. Cuando hay una actualización relevante —nuevos tipos de IVA, cambios en la factura electrónica, nuevos modelos fiscales— Factulista se actualiza automáticamente sin que tengas que instalar nada.',
        [checkItem('purple','Monitorización continua de AEAT y BOE'), checkItem('purple','Actualizaciones automáticas sin intervención del usuario'), checkItem('purple','Notificaciones sobre cambios que te afectan directamente')],
        '#7c3aed', 'Mantenerme siempre al día', 'AUTO-ACTUALIZACIÓN', IMG[3], 'Actualización normativa automática en Factulista', '#e9d5ff'),
      altSectionTextLeft('RGPD Y DOCUMENTACIÓN', 'background: rgb(207, 250, 254); color: rgb(8, 145, 178); border: 1px solid rgb(8, 145, 178); padding: 6px 16px;',
        'Cumple con el RGPD y ten la documentación de auditoría siempre lista',
        'Factulista actúa como encargado del tratamiento con total transparencia. Firmamos un DPA, tus datos no se venden, y puedes exportar o eliminar todo en cualquier momento. Para auditorías, genera el informe de actividad, el registro de operaciones y los libros fiscales en formato oficial.',
        [checkItem('cyan','DPA firmado y cumplimiento total con RGPD/LOPD-GDD'), checkItem('cyan','Tus datos no se venden ni comparten con terceros no autorizados'), checkItem('cyan','Documentación de auditoría descargable en cualquier momento')],
        'rgb(8, 145, 178)', 'Ver cumplimiento RGPD', 'RGPD', IMG[4], 'Cumplimiento RGPD en Factulista', '#cffafe'),
    ].join('\n')
  }

  return ''
}

const PAGE_DEFS: Record<string, PageDef> = {
  'control-de-pagos-y-cobros': {
    title: 'Control de Pagos y Cobros',
    description: 'Gestiona tu tesorería, haz seguimiento de cobros y mantén el control de tus pagos a proveedores con Factulista. Panel en tiempo real, recordatorios automáticos y conciliación bancaria.',
    heroBadge: 'CONTROL DE TESORERÍA',
    heroH1: 'Controla tu tesorería y<span style="color: var(--accent);">&nbsp;cobra siempre a tiempo</span>',
    heroSub: 'Factulista te da el control total sobre tus cobros y pagos: panel de tesorería en tiempo real, recordatorios automáticos para clientes, conciliación bancaria e informes de cash-flow. Sin hojas de cálculo, sin sorpresas.',
    sections: buildSections('control-de-pagos-y-cobros'),
    ctaH2: '¿Listo para controlar tu tesorería y cobrar antes?',
    ctaP: 'Únete a miles de autónomos y PYMEs que ya confían en Factulista para gestionar sus cobros y pagos.',
    faqTitle: 'Todo lo que necesitas saber sobre control de pagos y cobros',
    faqSubtitle: 'Resolvemos tus dudas sobre tesorería, seguimiento de cobros y gestión de pagos con Factulista.',
    faqs: [
      ['¿Cómo registro el cobro de una factura en Factulista?', 'Desde el listado de facturas, haz clic en la factura y selecciona "Marcar como cobrada". Puedes indicar la fecha de cobro, el importe parcial o total y el método de pago. El estado de la factura se actualiza al instante y queda reflejado en tu cuadro de tesorería.'],
      ['¿Puedo hacer seguimiento de facturas pendientes de cobro?', 'Sí. El panel de tesorería muestra todas las facturas pendientes, su fecha de vencimiento y el importe total por cobrar. Puedes filtrar por cliente, período o estado (vencida, por vencer, parcialmente cobrada) para tener siempre una visión clara de tu liquidez.'],
      ['¿Cómo gestiono los pagos a mis proveedores?', 'Factulista te permite registrar facturas recibidas de proveedores y marcarlas como pagadas cuando realices la transferencia. El sistema cruza automáticamente ingresos y gastos para ofrecerte un saldo de tesorería actualizado en tiempo real.'],
      ['¿Puedo conciliar mis movimientos bancarios con mis facturas?', 'Puedes importar los movimientos de tu banco en formato CSV y Factulista los sugiere automáticamente para conciliarlos con tus facturas emitidas y recibidas, reduciendo el trabajo manual de cuadrar las cuentas.'],
      ['¿Factulista me avisa cuando una factura está próxima a vencer?', 'Sí. Puedes activar recordatorios automáticos de cobro: Factulista envía un email a tu cliente cuando la factura está a punto de vencer o lleva días vencida. Tú decides el número de días y la frecuencia de los avisos.'],
      ['¿Puedo ver un informe de flujo de caja o cash-flow?', 'Desde la sección de informes tienes acceso al informe de flujo de caja con ingresos, gastos y saldo proyectado. Puedes filtrarlo por período y exportarlo a PDF o Excel para compartirlo con tu asesor o analizar tendencias de liquidez.'],
    ],
  },
  'gestion-de-facturas-recibidas-y-gastos': {
    title: 'Gestión de Facturas Recibidas y Gastos',
    description: 'Registra y organiza tus facturas de proveedor, digitaliza tickets y controla tu IVA soportado con Factulista. Modelo 303 automático y categorización de gastos para autónomos y pymes.',
    heroBadge: 'GESTIÓN DE GASTOS',
    heroH1: 'Gestiona tus gastos y facturas de proveedor<span style="color: var(--accent);">&nbsp;sin esfuerzo</span>',
    heroSub: 'Factulista centraliza todos tus gastos: registra facturas recibidas, digitaliza tickets con el móvil, categoriza por tipo de gasto y ten el IVA soportado calculado automáticamente para el modelo 303. Sin hojas de cálculo, sin cálculos manuales.',
    sections: buildSections('gestion-de-facturas-recibidas-y-gastos'),
    ctaH2: '¿Listo para controlar tus gastos y deducir todo lo que puedes?',
    ctaP: 'Únete a miles de autónomos y PYMEs que ya confían en Factulista para gestionar sus facturas recibidas y gastos.',
    faqTitle: 'Todo lo que necesitas saber sobre facturas recibidas y gastos',
    faqSubtitle: 'Resolvemos tus dudas sobre cómo registrar, organizar y deducir tus compras y gastos con Factulista.',
    faqs: [
      ['¿Cómo registro una factura de proveedor en Factulista?', 'Ve a la sección "Facturas recibidas", haz clic en "Nueva factura recibida" e introduce los datos del proveedor, importe, IVA y fecha. Si tienes el PDF, puedes adjuntarlo directamente para tenerlo todo en un solo lugar. La factura queda guardada y lista para el cálculo de tu IVA deducible.'],
      ['¿Puedo digitalizar tickets y justificantes de gasto desde el móvil?', 'Sí. Factulista tiene captura de tickets desde la app: haz una foto al justificante y el sistema extrae automáticamente el importe, la fecha y el proveedor mediante OCR. Los tickets digitalizados quedan vinculados a tu registro de gastos y son válidos para Hacienda.'],
      ['¿Cómo afectan las facturas recibidas a mi declaración del IVA?', 'Cada factura recibida con IVA que registres en Factulista suma al IVA soportado. Cuando llegue la declaración del modelo 303, Factulista calcula automáticamente la diferencia entre el IVA repercutido (de tus ventas) y el soportado (de tus compras), indicándote si tienes que ingresar o si Hacienda te debe devolver.'],
      ['¿Puedo categorizar los gastos para que cuadren con mis impuestos?', 'Sí. Puedes asignar a cada gasto una categoría contable: suministros, servicios profesionales, alquiler, material de oficina, etc. Factulista agrupa los gastos por categoría en tus informes, facilitando la preparación de los modelos fiscales junto a tu asesor.'],
      ['¿Factulista me ayuda a preparar el modelo 303 de IVA?', 'Factulista genera automáticamente el resumen de IVA repercutido y soportado por trimestre. Con un solo clic tienes los datos del modelo 303 listos para revisarlos o enviarlos a tu asesor fiscal, sin necesidad de sumar manualmente ninguna factura.'],
      ['¿Puedo importar facturas de proveedores habituales de forma masiva?', 'Sí, puedes importar facturas recibidas en bloque desde un fichero CSV o conectar con tus proveedores para recibir facturas electrónicas directamente. Para proveedores recurrentes puedes guardar sus datos y reutilizarlos en futuros registros con un solo clic.'],
    ],
  },
  'informes-avanzados': {
    title: 'Informes Avanzados',
    description: 'Genera informes financieros en tiempo real, exporta a PDF y Excel, analiza la rentabilidad por cliente y prepara tus modelos fiscales con Factulista. Dashboard completo para autónomos y pymes.',
    heroBadge: 'ANALÍTICA FINANCIERA',
    heroH1: 'Informes avanzados para tomar<span style="color: var(--accent);">&nbsp;mejores decisiones</span>',
    heroSub: 'Factulista genera en tiempo real todos los informes que necesitas: facturación, cash-flow, rentabilidad por cliente, IVA trimestral y modelos fiscales. Sin exportar ni cruzar datos manualmente. Todo listo para ti y para tu asesor.',
    sections: buildSections('informes-avanzados'),
    ctaH2: '¿Listo para tener el control financiero de tu negocio?',
    ctaP: 'Únete a miles de autónomos y PYMEs que ya confían en Factulista para sus informes financieros y fiscales.',
    faqTitle: 'Todo lo que necesitas saber sobre informes y analítica financiera',
    faqSubtitle: 'Resolvemos tus dudas sobre dashboards, exportaciones e informes fiscales en Factulista.',
    faqs: [
      ['¿Qué informes financieros puedo generar con Factulista?', 'Factulista incluye informes de facturación por período, flujo de caja, IVA repercutido y soportado, rentabilidad por cliente, gastos por categoría, y comparativas anuales. Todos se generan en tiempo real con los datos de tu cuenta, sin necesidad de exportar ni cruzar información manualmente.'],
      ['¿Puedo exportar los informes a Excel o PDF?', 'Sí. Todos los informes de Factulista tienen opción de exportar a PDF (para compartir o archivar) y a Excel o CSV (para trabajar los datos con tu asesor o en tus propias hojas de cálculo). La exportación conserva los filtros aplicados —período, cliente, categoría— para que obtengas exactamente lo que necesitas.'],
      ['¿Con qué frecuencia se actualizan los datos del dashboard?', 'El dashboard se actualiza en tiempo real: cada vez que emites una factura, registras un cobro o añades un gasto, los indicadores —facturación total, facturas pendientes, IVA, saldo de tesorería— reflejan el nuevo estado al instante, sin necesidad de refrescar manualmente.'],
      ['¿Puedo ver la rentabilidad por cliente o proyecto?', 'Sí. El informe de rentabilidad por cliente muestra cuánto has facturado, cuánto has cobrado y los gastos asociados a cada cliente o proyecto. Esto te permite identificar qué clientes son más rentables y tomar decisiones basadas en datos reales.'],
      ['¿Los informes me ayudan a preparar las declaraciones fiscales trimestrales?', 'Factulista genera el resumen de IVA (modelo 303), el resumen de retenciones (modelo 111/115) y el listado de operaciones con terceros (modelo 347) con todos los datos pre-calculados. Puedes enviárselos directamente a tu asesor o revisarlos tú mismo antes de presentarlos a Hacienda.'],
      ['¿Puedo compartir informes con mi asesor fiscal sin darle acceso a toda la cuenta?', 'Sí. Puedes invitar a tu asesor fiscal con un rol de "solo lectura" para que acceda a los informes y datos sin poder modificar nada. También puedes exportar y enviar los informes en PDF o Excel sin necesidad de dar acceso a la plataforma.'],
    ],
  },
  'gestion-de-clientes-y-proveedores': {
    title: 'Gestión de Clientes y Proveedores',
    description: 'Organiza tus clientes y proveedores en un solo lugar con Factulista. Historial de facturas, condiciones de pago personalizadas, portal del cliente y segmentación por etiquetas para autónomos y pymes.',
    heroBadge: 'CRM PARA AUTÓNOMOS',
    heroH1: 'Clientes y proveedores organizados<span style="color: var(--accent);">&nbsp;desde un solo lugar</span>',
    heroSub: 'Factulista centraliza toda la información de tus clientes y proveedores: historial completo, condiciones de pago personalizadas, portal privado para descarga de facturas y segmentación por etiquetas. Sin Excel, sin buscar datos en emails.',
    sections: buildSections('gestion-de-clientes-y-proveedores'),
    ctaH2: '¿Listo para tener a todos tus clientes y proveedores bajo control?',
    ctaP: 'Únete a miles de autónomos y PYMEs que ya confían en Factulista para gestionar sus relaciones comerciales.',
    faqTitle: 'Todo lo que necesitas saber sobre gestión de clientes y proveedores',
    faqSubtitle: 'Resolvemos tus dudas sobre el CRM, historial de contactos y condiciones de pago en Factulista.',
    faqs: [
      ['¿Puedo importar mis clientes existentes desde Excel o CSV?', 'Sí. Factulista permite importar clientes y proveedores en bloque desde un fichero CSV o Excel. Solo tienes que preparar el fichero con las columnas básicas (nombre, NIF, email, dirección) y el sistema los importa en segundos, sin tener que crearlos uno a uno.'],
      ['¿Cómo veo el historial completo de facturas de un cliente?', 'Desde la ficha de cada cliente tienes acceso a todo su historial: facturas emitidas, presupuestos enviados, cobros realizados, facturas vencidas y saldo pendiente. Puedes filtrar por período o estado para encontrar cualquier documento en segundos.'],
      ['¿Puedo asignar condiciones de pago diferentes a cada cliente?', 'Sí. En la ficha de cliente puedes establecer la forma de pago habitual (transferencia, domiciliación, tarjeta), el plazo de vencimiento (30, 60, 90 días…) y el descuento comercial por defecto. Estos valores se aplican automáticamente cada vez que creas una factura para ese cliente.'],
      ['¿Factulista tiene portal para que los clientes descarguen sus facturas?', 'Sí. Puedes enviar a tus clientes un enlace a su portal privado donde pueden ver y descargar todas las facturas que les has emitido, consultar el estado de sus pagos y actualizar sus datos de contacto. Esto reduce las consultas por email y mejora la experiencia del cliente.'],
      ['¿Puedo gestionar varios proveedores con distintas formas de pago?', 'Cada proveedor tiene su propia ficha con forma de pago, número de cuenta, plazo de pago y datos fiscales. Cuando registras una factura recibida de ese proveedor, Factulista pre-rellena automáticamente todos sus datos, reduciendo el tiempo de entrada a segundos.'],
      ['¿Es posible segmentar clientes por categoría o etiquetas?', 'Sí. Puedes asignar etiquetas personalizadas a tus clientes —por sector, tamaño, origen, producto contratado— para segmentarlos y filtrar rápidamente tus informes de facturación o enviar comunicaciones dirigidas a un grupo concreto.'],
    ],
  },
  'cumplimiento-normativo': {
    title: 'Cumplimiento Fiscal y Normativo',
    description: 'Factulista cumple con VeriFactu (RD 1007/2023), el Reglamento de Facturación (RD 1619/2012), el RGPD y la LOPD-GDD. Actualizaciones automáticas y documentación de auditoría incluidas.',
    heroBadge: 'SIEMPRE EN REGLA',
    heroH1: 'Cumple con toda la normativa fiscal<span style="color: var(--accent);">&nbsp;automáticamente</span>',
    heroSub: 'Factulista incorpora VeriFactu, el Reglamento de Facturación, el RGPD y la LOPD-GDD de forma automática. Sin tecnicismos, sin actualizaciones manuales, sin preocupaciones ante inspecciones. Tú factura, nosotros cumplimos por ti.',
    sections: buildSections('cumplimiento-normativo'),
    ctaH2: '¿Listo para cumplir con toda la normativa sin complicaciones?',
    ctaP: 'Únete a miles de autónomos y PYMEs que ya confían en Factulista para mantenerse siempre en regla con Hacienda.',
    faqTitle: 'Todo lo que necesitas saber sobre cumplimiento fiscal y normativo',
    faqSubtitle: 'Resolvemos tus dudas sobre VeriFactu, RGPD, seguridad y actualizaciones normativas en Factulista.',
    faqs: [
      ['¿Está Factulista adaptado para VeriFactu según el RD 1007/2023?', 'Sí. Factulista cumple con los requisitos técnicos del Real Decreto 1007/2023. Genera el registro de facturación con huella digital (hash encadenado), firma electrónica y código QR en cada factura, tal y como exige la AEAT. Puedes elegir el modo "VeriFactu SÍ" para envío automático o "VeriFactu NO" para conservar los registros internamente sin conexión con Hacienda.'],
      ['¿Cómo cumple Factulista con el Reglamento de Facturación Electrónica (RD 1619/2012)?', 'Factulista genera facturas con todos los campos obligatorios del RD 1619/2012: número correlativo, fecha de expedición, datos del emisor y receptor, descripción de los bienes o servicios, base imponible, tipo y cuota de IVA y, cuando procede, retención de IRPF. Las facturas son inmutables una vez emitidas y quedan archivadas de forma segura.'],
      ['¿Qué pasa si Hacienda hace una inspección? ¿Están mis datos protegidos?', 'Factulista conserva todas tus facturas y registros fiscales durante el plazo legal (mínimo 4 años, 10 años para ciertos documentos). En caso de inspección, puedes exportar en segundos todos los libros de registro en formato oficial. Nuestros servidores están en la UE, con copias de seguridad automáticas y cifrado de datos en tránsito y en reposo.'],
      ['¿Se actualiza Factulista automáticamente cuando cambia la normativa?', 'Sí. Nuestro equipo monitoriza continuamente los cambios normativos publicados por la AEAT y el BOE. Cuando hay una actualización relevante —nuevos tipos de IVA, cambios en la factura electrónica, nuevos modelos fiscales— Factulista se actualiza automáticamente sin que tengas que hacer nada.'],
      ['¿Factulista cumple con el RGPD y la LOPD-GDD?', 'Sí. Factulista actúa como encargado del tratamiento de los datos de tus clientes y proveedores con total transparencia. Firmamos un Acuerdo de Encargo del Tratamiento (DPA), tus datos no se venden ni se comparten con terceros no autorizados, y puedes exportar o eliminar todos tus datos en cualquier momento desde tu cuenta.'],
      ['¿Puedo obtener documentación de cumplimiento para mi asesor o una auditoría?', 'Sí. Desde tu cuenta puedes descargar el informe de auditoría de actividad, el registro de operaciones, los libros de facturas emitidas y recibidas en formato oficial, y el DPA firmado. Esta documentación es suficiente para acreditar el cumplimiento ante inspecciones, auditorías o concursos públicos.'],
    ],
  },
}

function buildFaqSection(def: PageDef) {
  const items = def.faqs.map(([q, a], i) => faqItem(q, a, i === 0)).join('\n        ')
  return `${FAQ_CSS}
  <section class="faq" id="faqs">
    <div class="container">
      <div class="section-header center">
        <span class="section-label">PREGUNTAS FRECUENTES</span>
        <h2 class="section-title">${def.faqTitle}</h2>
        <p class="section-sub">${def.faqSubtitle}</p>
      </div>
      <div class="faq-grid">
        ${items}
      </div>
    </div>
  </section>
  ${FAQ_JS}`
}

function buildPageHtml(templateHtml: string, slug: string, def: PageDef): string {
  let html = templateHtml

  // 1. Update title and meta description
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${def.title} | Factulista</title>`)
  html = html.replace(/(<meta[^>]+name=["']description["'][^>]+content=["'])[^"']*["']/, `$1${def.description}"`)
  html = html.replace(/(<meta[^>]+content=["'])[^"']*["']([^>]+name=["']description["'])/, `$1${def.description}"$2`)

  // 2. Replace hero section
  const heroNew = `<section class="hero">
    <div class="hero-grid-bg"></div>
    <div class="hero-inner">
      <div class="badge">
        <span class="badge-dot"></span> ${def.heroBadge}</div>
      <h1>${def.heroH1}</h1>
      <p class="hero-sub">${def.heroSub}</p>
      <div class="hero-ctas">
        <a href="https://app.factulista.com/registro" class="btn-primary" target="_blank" rel="noopener noreferrer">
          Probar gratis - sin tarjeta${ARROW_SVG}
        </a>
        <a href="#faqs" class="btn-secondary">Ver funcionalidades</a>
      </div>
      <p style="font-size: 0.85rem; color: rgb(115, 115, 115); margin-top: 4px;">Plan gratuito disponible · Preparado para VeriFactu 2027</p>
    </div>
  </section>`
  html = html.replace(/<section class="hero">[\s\S]*?<\/section>/, heroNew)

  // 3. Remove all existing alt-sections and cta-banner (between hero and faq)
  html = html.replace(/(?:<!-- ──[\s\S]*?──[\s\S]*?-->[\s\n]*)?<section class="alt-section">[\s\S]*?<\/section>\s*/g, '')
  html = html.replace(/(?:<!-- ──[\s\S]*?──[\s\S]*?-->[\s\n]*)?<section class="cta-banner">[\s\S]*?<\/section>\s*/g, '')

  // 4. Remove existing FAQ section
  html = html.replace(/<style id="faq-styles">[\s\S]*?<\/style>\s*/g, '')
  html = html.replace(/<section[^>]*class="faq"[^>]*>[\s\S]*?<\/section>\s*/g, '')
  html = html.replace(/<script[^>]*>[\s\S]*?\.faq-trigger[\s\S]*?<\/script>/g, '')

  // 5. Build cta-banner
  const ctaBanner = `<section class="cta-banner">
    <div class="cta-inner">
      <h2>${def.ctaH2}</h2>
      <p>${def.ctaP}</p>
      <a href="https://app.factulista.com/registro" class="btn-primary" target="_blank" rel="noopener noreferrer">
        Crear cuenta GRATIS${ARROW_SVG}
      </a>
      <p style="font-size: 0.85rem; margin-top: 16px;">Sin tarjeta de crédito. Plan gratuito disponible.</p>
    </div>
  </section>`

  // 6. Build full FAQ section
  const faqSection = buildFaqSection(def)

  // 7. Inject sections + cta + faq before </main>
  const newSections = `\n${def.sections}\n\n  ${ctaBanner}\n\n  ${faqSection}\n`
  if (html.includes('</main>')) {
    html = html.replace('</main>', `${newSections}</main>`)
  } else if (html.includes('<footer')) {
    html = html.replace(/(<footer[^>]*>)/, `${newSections}$1`)
  }

  return html
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const projectId = (body?.projectId as string) || '6a436817-7c0a-40ed-aa26-8aeffdc128f4'
  const dryRun = body?.dryRun === true

  const supabase = getSupabase()
  const { data, error } = await supabase.from('projects').select('site_config').eq('id', projectId).single()
  if (error || !data) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const cfg = (data.site_config ?? {}) as Record<string, unknown>
  const pages = (cfg.pages as Array<Record<string, unknown>>) ?? []
  const publishedPages = (cfg.published_pages as Array<Record<string, unknown>>) ?? []

  // Get verifactu template from published_pages
  const verifactuPub = publishedPages.find(p => p.slug === 'facturacion-verifactu')
  const verifactuDraft = pages.find(p => p.slug === 'facturacion-verifactu')
  if (!verifactuPub) return NextResponse.json({ error: 'facturacion-verifactu template not found in published_pages' }, { status: 500 })

  const templateHtml = verifactuPub.html as string
  if (!templateHtml || templateHtml.length < 1000) {
    return NextResponse.json({ error: 'verifactu template HTML too short, something is wrong', len: templateHtml?.length }, { status: 500 })
  }

  const slugsToRestore = Object.keys(PAGE_DEFS)
  const results: Record<string, { pubLen: number; draftLen: number }> = {}
  const builtHtmls: Record<string, string> = {}

  for (const slug of slugsToRestore) {
    const def = PAGE_DEFS[slug]
    const newHtml = buildPageHtml(templateHtml, slug, def)
    builtHtmls[slug] = newHtml
    results[slug] = { pubLen: newHtml.length, draftLen: newHtml.length }
  }

  if (dryRun) {
    return NextResponse.json({ message: 'DRY RUN — not saved', results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { pubLen: v.pubLen, preview: builtHtmls[k].slice(0, 500) }])) })
  }

  // Apply to both lists
  const applyToList = (list: Array<Record<string, unknown>>) =>
    list.map(p => {
      const slug = p.slug as string
      if (!slugsToRestore.includes(slug)) return p
      return { ...p, html: builtHtmls[slug] }
    })

  const newPages = applyToList(pages)
  const newPublished = applyToList(publishedPages)

  // Also ensure verifactu draft matches verifactu published (not touched but keep consistent)
  const { error: saveErr } = await supabase.from('projects').update({
    site_config: { ...cfg, pages: newPages, published_pages: newPublished },
    updated_at: new Date().toISOString(),
  }).eq('id', projectId)

  if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })

  return NextResponse.json({ message: 'Pages restored successfully', results, templateLen: templateHtml.length })
}
