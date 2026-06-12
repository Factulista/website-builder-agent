/** Provider registry — look up a SocialProvider by id. */
import type { ProviderId, SocialProvider } from '../types'
import { facebookProvider } from './facebook'

const PROVIDERS: Partial<Record<ProviderId, SocialProvider>> = {
  facebook: facebookProvider,
  // instagram: instagramProvider,   // Phase 2
  // linkedin: linkedinProvider,     // Phase 3
}

export function getProvider(id: string): SocialProvider {
  const p = PROVIDERS[id as ProviderId]
  if (!p) throw new Error(`Provider non supportato: ${id}`)
  return p
}

export function listProviders(): SocialProvider[] {
  return Object.values(PROVIDERS).filter(Boolean) as SocialProvider[]
}
