import { NextRequest } from 'next/server'
import { Resend } from 'resend'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)

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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const tipo = body.tipo as string | undefined
  if (!tipo || !['CRM', 'sugerencia-modulo', 'contacto'].includes(tipo)) {
    return Response.json({ error: 'Campo "tipo" inválido o ausente' }, { status: 400 })
  }

  const nombre = (body.nombre as string | undefined)?.trim()
  const email  = (body.email  as string | undefined)?.trim()
  if (!nombre || !email) {
    return Response.json({ error: 'Campos "nombre" y "email" son obligatorios' }, { status: 400 })
  }

  let payload: FormPayload
  if (tipo === 'CRM') {
    payload = { tipo: 'CRM', nombre, email }

  } else if (tipo === 'sugerencia-modulo') {
    const modulo      = (body.modulo      as string | undefined)?.trim() ?? ''
    const descripcion = (body.descripcion as string | undefined)?.trim() ?? ''
    payload = { tipo: 'sugerencia-modulo', nombre, email, modulo, descripcion }

  } else {
    const empresa = (body.empresa as string | undefined)?.trim()
    const mensaje = (body.mensaje as string | undefined)?.trim() ?? ''
    payload = { tipo: 'contacto', nombre, email, empresa, mensaje }
  }

  const { subject, html } = buildEmail(payload)

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
