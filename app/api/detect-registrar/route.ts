import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type RegistrarEntry = {
  key: string
  name: string
  panelUrl: (d: string) => string
  note: string
}

const REGISTRARS: RegistrarEntry[] = [
  { key: 'godaddy', name: 'GoDaddy', panelUrl: (d) => `https://dcc.godaddy.com/manage/${d}/dns`, note: 'DNS Manager → Add → CNAME' },
  { key: 'namecheap', name: 'Namecheap', panelUrl: (d) => `https://ap.www.namecheap.com/domains/domaincontrolpanel/${d}/advancedns`, note: 'Advanced DNS → Add New Record → CNAME' },
  { key: 'squarespace', name: 'Squarespace', panelUrl: (d) => `https://account.squarespace.com/domains/managed/${d}/dns/dns-settings`, note: 'DNS Settings → Add Record → CNAME' },
  { key: 'porkbun', name: 'Porkbun', panelUrl: () => `https://porkbun.com/account/domainsSpeedy`, note: 'DNS → aggiungi CNAME accanto al tuo dominio' },
  { key: 'aruba', name: 'Aruba.it', panelUrl: () => `https://admin.aruba.it/`, note: 'Gestione DNS → Aggiungi record CNAME' },
  { key: 'register', name: 'Register.it', panelUrl: () => `https://www.register.it/`, note: 'DNS Manager → Aggiungi CNAME' },
  { key: 'ionos', name: 'IONOS', panelUrl: () => `https://my.ionos.it/`, note: 'Domini → DNS → Aggiungi CNAME' },
  { key: 'ovh', name: 'OVH', panelUrl: (d) => `https://www.ovh.com/manager/web/#/domain/${d}/dns`, note: 'Zone DNS → Aggiungi record CNAME' },
  { key: 'siteground', name: 'SiteGround', panelUrl: () => `https://my.siteground.com/`, note: 'Domain Manager → DNS → Aggiungi CNAME' },
  { key: 'netsons', name: 'Netsons', panelUrl: () => `https://control.netsons.com/`, note: 'Pannello DNS → Aggiungi CNAME' },
]

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const domain = searchParams.get('domain')?.trim()

    if (!domain) {
      return NextResponse.json({ error: 'domain è richiesto' }, { status: 400 })
    }

    // 1. Check NS records via Google DoH
    let isCloudflare = false
    try {
      const dohRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=NS`, {
        headers: { Accept: 'application/dns-json' },
      })
      if (dohRes.ok) {
        const dohData = await dohRes.json() as { Answer?: { data: string }[] }
        const answers: { data: string }[] = dohData.Answer ?? []
        isCloudflare = answers.some((a) => a.data.includes('ns.cloudflare.com'))
      }
    } catch {
      // ignore DNS lookup errors
    }

    // 2. Get registrar via RDAP (3s timeout)
    let registrarName: string | null = null
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const rdapRes = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (rdapRes.ok) {
        const rdapData = await rdapRes.json() as { entities?: { roles?: string[]; vcardArray?: unknown[] }[] }
        // Find registrar entity
        const registrarEntity = (rdapData.entities ?? []).find(
          (e) => e.roles?.includes('registrar')
        )
        if (registrarEntity?.vcardArray) {
          // vcardArray is ["vcard", [[...], ...]] — fn is usually index 1[1][3]
          const vcard = registrarEntity.vcardArray as [string, [string, unknown, string, string][]]
          const fnEntry = vcard[1]?.find?.((entry) => entry[0] === 'fn')
          if (fnEntry) registrarName = String(fnEntry[3])
        }
      }
    } catch {
      // ignore RDAP errors (timeout, not found, etc.)
    }

    // 3. Match registrar name against known registrars
    let matched: RegistrarEntry | null = null
    if (registrarName) {
      const lower = registrarName.toLowerCase()
      for (const r of REGISTRARS) {
        if (lower.includes(r.key) || lower.includes(r.name.toLowerCase())) {
          matched = r
          break
        }
      }
    }

    return NextResponse.json({
      isCloudflare,
      registrarName,
      registrarKey: matched?.key ?? null,
      dnsPanel: matched ? matched.panelUrl(domain) : null,
      note: matched?.note ?? null,
    })
  } catch (error) {
    console.error('detect-registrar error:', error)
    return NextResponse.json(
      { isCloudflare: false, registrarName: null, registrarKey: null, dnsPanel: null, note: null },
      { status: 200 }
    )
  }
}
