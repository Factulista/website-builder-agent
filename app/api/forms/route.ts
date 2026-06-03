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

function buildEmailHtml(subject: string, rows: string, footer?: string): string {
  const ts = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;padding:32px 0;margin:0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#1a1a1a;padding:20px 28px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:1.3rem;">⚡</span>
      <p style="margin:0;color:#fff;font-size:1rem;font-weight:600;">${subject}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
    ${footer ? `<div style="padding:16px 28px;background:#f0fdf4;border-top:1px solid #bbf7d0;">${footer}</div>` : ''}
    <div style="padding:12px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:0.72rem;color:#9ca3af;">Factulista · ${ts}</p>
    </div>
  </div>
</body>
</html>`
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;width:140px;vertical-align:top;border-bottom:1px solid #f3f4f6">${label}</td><td style="padding:8px 12px;color:#1f2937;border-bottom:1px solid #f3f4f6">${value}</td></tr>`

/** Email to admin — all form fields */
function buildAdminEmail(payload: FormPayload): { subject: string; html: string } {
  if (payload.tipo === 'CRM') return {
    subject: 'Nuevo interés en módulo CRM',
    html: buildEmailHtml('Nuevo interés en módulo CRM',
      row('Nombre', payload.nombre) + row('Email', payload.email)),
  }
  if (payload.tipo === 'sugerencia-modulo') return {
    subject: 'Nueva sugerencia de módulo',
    html: buildEmailHtml('Nueva sugerencia de módulo',
      row('Nombre', payload.nombre) + row('Email', payload.email) +
      row('Módulo', payload.modulo) + row('Descripción', payload.descripcion)),
  }
  // contacto
  return {
    subject: 'Nuevo mensaje de contacto — Factulista',
    html: buildEmailHtml('Nuevo mensaje de contacto',
      row('Nombre', payload.nombre) + row('Email', payload.email) +
      (payload.empresa ? row('Empresa', payload.empresa) : '') +
      row('Mensaje', payload.mensaje)),
  }
}

/** Confirmation email to the user who submitted the form */
function buildUserConfirmation(payload: FormPayload, customMsg?: string): { subject: string; html: string } {
  let greeting = customMsg || `Hola <strong>${payload.nombre}</strong>,<br><br>
    Hemos recibido tu mensaje. Te responderemos lo antes posible a <strong>${payload.email}</strong>.`
  // Replace placeholders [nombre] and [email]
  greeting = greeting.replace(/\[nombre\]/g, payload.nombre).replace(/\[email\]/g, payload.email)
  const greetingHtml = `<p style="padding:16px 28px 0;margin:0;color:#374151;">${greeting}</p>`

  let rows = row('Nombre', payload.nombre) + row('Email', payload.email)
  if ('empresa' in payload && payload.empresa) rows += row('Empresa', payload.empresa)
  if ('mensaje' in payload && payload.mensaje) rows += row('Mensaje', payload.mensaje)
  if ('modulo' in payload && payload.modulo) rows += row('Módulo', payload.modulo)
  if ('descripcion' in payload && payload.descripcion) rows += row('Descripción', payload.descripcion)

  const footer = `<p style="margin:0;font-size:0.82rem;color:#065f46;font-weight:500;">✓ Tu mensaje ha sido enviado correctamente</p>`

  return {
    subject: 'Hemos recibido tu mensaje — Factulista',
    html: buildEmailHtml('Resumen de tu mensaje', greetingHtml + '<table style="width:100%;border-collapse:collapse;margin-top:12px;"><tbody>' + rows + '</tbody></table>', footer),
  }
}

/**
 * Tries to detect the project from the request Origin/Referer header
 * by matching the host against custom_domain or the staging subdomain slug.
 */
async function detectProjectFromRequest(req: NextRequest): Promise<Record<string, unknown> | null> {
  // Also accept projectId in body for explicit matching
  const bodyHint = (req as unknown as { _projectId?: string })._projectId

  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (!origin && !bodyHint) return null

  let host: string = ''
  try {
    host = origin ? new URL(origin).hostname : ''
  } catch {
    return null
  }

  if (!host) return null

  // Normalize: try both www.host and host without www
  const wwwHost    = host.startsWith('www.') ? host : `www.${host}`
  const bareHost   = host.replace(/^www\./, '')

  // Match by custom_domain (try exact, www-variant, and bare variant)
  const { data: byDomain } = await supabase
    .from('projects')
    .select('site_config')
    .in('custom_domain', [host, wwwHost, bareHost])
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (byDomain?.site_config) return byDomain.site_config as Record<string, unknown>

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

  // Backwards compat: older forms sent modulo:'CRM' instead of tipo:'CRM'
  const tipo = (body.tipo ?? (body.modulo === 'CRM' ? 'CRM' : undefined)) as string | undefined
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

  // ── Cloudflare Turnstile verification ────────────────────────────────────────
  const turnstileSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET
  const turnstileToken  = (body['cf-turnstile-response'] as string | undefined)?.trim()

  if (turnstileSecret) {
    if (!turnstileToken) {
      console.warn(`[forms] Turnstile token missing — origin: ${origin}`)
      return Response.json({ error: 'Verifica anti-bot mancante. Ricarica la pagina e riprova.', turnstileFailed: true }, { status: 400 })
    }
    try {
      const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: turnstileSecret, response: turnstileToken }),
        signal: AbortSignal.timeout(8000),
      })
      const result = await verify.json() as { success: boolean; 'error-codes'?: string[] }
      if (!result.success) {
        console.warn(`[forms] Turnstile failed — codes: ${(result['error-codes'] ?? []).join(',')} — origin: ${origin}`)
        return Response.json({ error: 'Verifica anti-bot fallita. Ricarica la pagina e riprova.', turnstileFailed: true }, { status: 400 })
      }
      console.log(`[forms] Turnstile OK — origin: ${origin}`)
    } catch (err) {
      // Non-fatal: if Cloudflare is down, let the form through
      console.error(`[forms] Turnstile verification error (non-fatal, letting through): ${err}`)
    }
  }
  // ── End Turnstile ─────────────────────────────────────────────────────────────

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

  // ── Load per-project component config (admin email, confirm message, redirect, email message) ─
  let projectAdminEmail = ADMIN_EMAIL
  let projectConfirmMsg = ''
  let projectConfirmEmailMsg = ''
  let projectRedirectUrl = ''
  try {
    let siteConfig = await detectProjectFromRequest(req)

    // Fallback: if project_id is passed in body, look up directly
    if (!siteConfig && body.project_id) {
      const { data: byId } = await supabase
        .from('projects')
        .select('site_config')
        .eq('id', body.project_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (byId?.site_config) siteConfig = byId.site_config as Record<string, unknown>
    }

    if (siteConfig) {
      // Load all form configs — fall back to contact_form values if specific config not set
      const cfConfig      = ((siteConfig as any)?.components_config?.contact_form  ?? {}) as Record<string, string>
      const crmConfig     = ((siteConfig as any)?.components_config?.crm_form      ?? {}) as Record<string, string>
      const suggestConfig = ((siteConfig as any)?.components_config?.suggest_form  ?? {}) as Record<string, string>

      const formConfig = tipo === 'CRM' ? crmConfig : tipo === 'sugerencia-modulo' ? suggestConfig : cfConfig

      if (formConfig.admin_email) projectAdminEmail = formConfig.admin_email
      else if (cfConfig.admin_email) projectAdminEmail = cfConfig.admin_email
      if (formConfig.confirm_message) projectConfirmMsg = formConfig.confirm_message
      if (formConfig.confirm_email_message) projectConfirmEmailMsg = formConfig.confirm_email_message
      if (formConfig.redirect_url) projectRedirectUrl = formConfig.redirect_url

      console.log(`[forms] project config found — tipo: ${tipo}, admin: "${projectAdminEmail}", redirect: "${projectRedirectUrl}"`)

    } else {
      console.warn(`[forms] project not found for origin: ${origin}`)
    }
  } catch { /* non-fatal */ }

  // ── Resend email notification (optional) ────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[forms] RESEND_API_KEY not set — skipping email notification')
    return Response.json({ success: true, emailSent: false, reason: 'RESEND_API_KEY not configured' })
  }

  const resend = new Resend(apiKey)

  // Send both emails in parallel — admin notification + user confirmation
  const adminEmail = buildAdminEmail(payload)
  const userEmail  = buildUserConfirmation(payload, projectConfirmEmailMsg || undefined)

  const [adminResult, userResult] = await Promise.allSettled([
    resend.emails.send({
      from:    FROM_EMAIL,
      to:      projectAdminEmail,
      replyTo: email,
      subject: adminEmail.subject,
      html:    adminEmail.html,
    }),
    resend.emails.send({
      from:    FROM_EMAIL,
      to:      email,
      subject: userEmail.subject,
      html:    userEmail.html,
    }),
  ])

  const adminId  = adminResult.status === 'fulfilled' ? adminResult.value?.data?.id  : null
  const adminErr = adminResult.status === 'rejected'  ? adminResult.reason            : adminResult.value?.error
  const userId   = userResult.status  === 'fulfilled' ? userResult.value?.data?.id   : null
  const userErr  = userResult.status  === 'rejected'  ? userResult.reason             : userResult.value?.error

  if (adminErr) console.error('[forms] Resend admin email error:', adminErr)
  if (userErr)  console.warn('[forms] Resend user email error (non-fatal):', userErr)
  console.log(`[forms] result — adminId: ${adminId ?? 'FAILED'}, userId: ${userId ?? 'FAILED'}, redirectUrl: "${projectRedirectUrl}"`)

  // Always return success — email errors are non-fatal (form data is received regardless)
  return Response.json({
    success: true,
    emailSent: !!adminId,
    ...(adminErr ? { emailError: String(adminErr) } : {}),
    ...(projectConfirmMsg  ? { confirmMessage: projectConfirmMsg }   : {}),
    ...(projectRedirectUrl ? { redirectUrl:    projectRedirectUrl }  : {}),
  })
}
