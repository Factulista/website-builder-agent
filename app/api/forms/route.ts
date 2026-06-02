import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { supabase } from '../../../lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Instantiated lazily inside the handler so missing env vars don't crash the build
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'info@factulista.com'
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@factulista.com'

type FormPayload =
  | { tipo: 'CRM';               nombre: string; email: string }
  | { tipo: 'sugerencia-modulo'; nombre: string; email: string; modulo: string; descripcion: string }
  | { tipo: 'contacto';          nombre: string; email: string; empresa?: string; mensaje: string }

function buildEmail(payload: FormPayload): { subject: string; html: string } {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;width:140px;vertical-align:top;border-bottom:1px solid #f3f4f6">${label}</td><td style="padding:8px 12px;color:#1f2937;border-bottom:1px solid #f3f4f6">${value}</td></tr>`

  const wrap = (subject: string, rows: string) => ({
    subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;padding:32px 0;margin:0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1a1a1a;padding:20px 28px;">
      <p style="margin:0;color:#fff;font-size:1rem;font-weight:600;">${subject}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:0.75rem;color:#9ca3af;">Inviato da Factulista · ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
    </div>
  </div>
</body>
</html>`,
  })

  if (payload.tipo === 'CRM') {
    return wrap(
      'Nuevo interés en módulo CRM',
      row('Nombre', payload.nombre) + row('Email', payload.email),
    )
  }

  if (payload.tipo === 'sugerencia-modulo') {
    return wrap(
      'Nueva sugerencia de módulo',
      row('Nombre', payload.nombre) +
      row('Email', payload.email) +
      row('Módulo', payload.modulo) +
      row('Descripción', payload.descripcion),
    )
  }

  // tipo === 'contacto'
  return wrap(
    'Nuevo mensaje de contacto',
    row('Nombre', payload.nombre) +
    row('Email', payload.email) +
    (payload.empresa ? row('Empresa', payload.empresa) : '') +
    row('Mensaje', payload.mensaje),
  )
}

/**
 * Tries to detect the project from the request Origin/Referer header
 * by matching the host against custom_domain or the staging subdomain slug.
 */
async function detectProjectFromRequest(req: NextRequest): Promise<Record<string, unknown> | null> {
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (!origin) return null

  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return null
  }

  if (!host) return null

  // 1. Try to match by custom_domain
  const { data: byDomain } = await supabase
    .from('projects')
    .select('site_config')
    .eq('custom_domain', host)
    .maybeSingle()

  if (byDomain?.site_config) return byDomain.site_config as Record<string, unknown>

  // 2. Try to match by staging subdomain — host pattern: myweb.<root>/<slug> or /<slug> path
  // For staging the slug is a path segment, not a subdomain — skip subdomain matching here.
  // Callers on the same origin (Next.js preview) would match host === window.location.hostname
  // which is not a custom domain, so there's nothing else to match without a projectSlug hint.

  return null
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? 'unknown'
  const ct = req.headers.get('content-type') ?? 'missing'

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch (parseErr) {
    console.error(`[forms] JSON parse failed — origin: ${origin}, content-type: ${ct}, err: ${parseErr}`)
    return Response.json({ error: 'Body JSON inválido', debug: { origin, contentType: ct } }, { status: 400 })
  }

  const tipo = body.tipo as string | undefined
  if (!tipo || !['CRM', 'sugerencia-modulo', 'contacto'].includes(tipo)) {
    console.error(`[forms] tipo invalido — tipo: "${tipo}", origin: ${origin}, body keys: ${Object.keys(body).join(',')}`)
    return Response.json({ error: 'Campo "tipo" inválido o ausente', debug: { tipo, origin } }, { status: 400 })
  }

  const nombre = (body.nombre as string | undefined)?.trim()
  const email  = (body.email  as string | undefined)?.trim()
  if (!nombre || !email) {
    console.error(`[forms] campi mancanti — nombre: "${nombre}", email: "${email}", origin: ${origin}`)
    return Response.json({ error: 'Campos "nombre" y "email" son obligatorios', debug: { hasNombre: !!nombre, hasEmail: !!email } }, { status: 400 })
  }

  const empresa = (body.empresa as string | undefined)?.trim()

  let payload: FormPayload
  if (tipo === 'CRM') {
    payload = { tipo: 'CRM', nombre, email }

  } else if (tipo === 'sugerencia-modulo') {
    const modulo      = (body.modulo      as string | undefined)?.trim() ?? ''
    const descripcion = (body.descripcion as string | undefined)?.trim() ?? ''
    payload = { tipo: 'sugerencia-modulo', nombre, email, modulo, descripcion }

  } else {
    const mensaje = (body.mensaje as string | undefined)?.trim() ?? ''
    payload = { tipo: 'contacto', nombre, email, empresa, mensaje }
  }

  // ── Brevo integration ────────────────────────────────────────────────────────
  // Detect project from Origin/Referer and push contact to Brevo if configured.
  try {
    const siteConfig = await detectProjectFromRequest(req)
    if (siteConfig) {
      const integrations = (siteConfig.integrations ?? {}) as Record<string, unknown>
      const brevo = (integrations.brevo ?? {}) as Record<string, unknown>
      const brevoApiKey = (brevo.apiKey as string | undefined)?.trim()
      const brevoListId = (brevo.listId as string | number | undefined)

      if (brevoApiKey && brevoListId) {
        const listIdNum = parseInt(String(brevoListId), 10)
        if (!isNaN(listIdNum)) {
          const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
              'api-key': brevoApiKey,
              'content-type': 'application/json',
              'accept': 'application/json',
            },
            body: JSON.stringify({
              email: email,
              attributes: {
                FIRSTNAME: nombre,
                ...(empresa ? { COMPANY: empresa } : {}),
              },
              listIds: [listIdNum],
              updateEnabled: true,
            }),
          })
          if (!brevoRes.ok) {
            const errText = await brevoRes.text().catch(() => '')
            console.error('[forms] Brevo error:', brevoRes.status, errText)
          }
        }
      }
    }
  } catch (err) {
    // Never break form submission due to Brevo errors
    console.error('[forms] Brevo integration error (non-fatal):', err)
  }
  // ── End Brevo integration ────────────────────────────────────────────────────

  // ── Resend email notification (optional) ────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[forms] RESEND_API_KEY not set — skipping email notification')
    return Response.json({ success: true })
  }

  const { subject, html } = buildEmail(payload)
  const resend = new Resend(apiKey)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to:   ADMIN_EMAIL,
    replyTo: email,
    subject,
    html,
  })

  if (error) {
    console.error('[/api/forms] Resend error:', error)
    return Response.json({ error: 'Error al enviar el email' }, { status: 500 })
  }

  return Response.json({ success: true })
}
