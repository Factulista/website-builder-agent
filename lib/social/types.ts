/**
 * Social module — shared types and the provider abstraction.
 * Adding a new network = implement one SocialProvider; the UI and API routes
 * stay unchanged.
 */

export type ProviderId = 'facebook' | 'instagram' | 'linkedin'

/** What a provider can do (drives the UI: hide edit/delete where unsupported). */
export type ProviderCapabilities = {
  edit: boolean          // can edit an already-published post via API
  delete: boolean        // can delete via API
  schedule: boolean      // native scheduling (else handled by our cron)
  requiresImage: boolean // post must include an image (Instagram)
  maxChars: number
}

/** A publishable target discovered after OAuth (a FB page, an IG account, 'me'). */
export type ProviderTarget = {
  externalId: string         // page id / ig id / person urn
  name: string               // human label
  meta?: Record<string, unknown> // e.g. { pageToken, ig_account_id, picture }
}

/** Tokens returned by an OAuth exchange. */
export type ProviderTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt?: string         // ISO
  scopes?: string
}

/** The content to publish (network-agnostic). */
export type PostContent = {
  text: string
  mediaUrls?: string[]       // public image/video URLs (Supabase storage)
  link?: string
}

/** Result of a publish call. */
export type PublishResult = {
  externalId: string         // id of the created post on the network
  url?: string               // permalink, if available
}

/**
 * One network integration. Stateless: every method receives the data it needs
 * (token, target) so the same instance serves all users.
 */
export interface SocialProvider {
  id: ProviderId
  label: string
  capabilities: ProviderCapabilities

  /** Build the OAuth authorize URL the user is redirected to. */
  getAuthUrl(redirectUri: string, state: string): string

  /** Exchange the OAuth `code` for tokens (long-lived where applicable). */
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokens>

  /** Discover publishable targets for these tokens (pages / accounts / 'me'). */
  listTargets(tokens: ProviderTokens): Promise<ProviderTarget[]>

  /** Publish content to a target. `target.meta` carries provider-specific data. */
  publish(target: ProviderTarget, tokens: ProviderTokens, content: PostContent): Promise<PublishResult>

  /** Delete a previously published post (if capabilities.delete). */
  deletePost?(target: ProviderTarget, tokens: ProviderTokens, externalId: string): Promise<void>

  /** Edit a published post (if capabilities.edit — Facebook only). */
  editPost?(target: ProviderTarget, tokens: ProviderTokens, externalId: string, content: PostContent): Promise<void>

  /** Refresh an expiring token (if the provider supports it). */
  refresh?(tokens: ProviderTokens): Promise<ProviderTokens>
}

/** DB row shape (decrypted tokens are NOT part of this — handled separately). */
export type SocialConnectionRow = {
  id: string
  user_id: string
  provider: ProviderId
  external_id: string
  account_name: string | null
  token_expires_at: string | null
  scopes: string | null
  meta: Record<string, unknown>
  status: 'active' | 'expired'
  created_at: string
  updated_at: string
}
