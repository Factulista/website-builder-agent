/** Shared domain types used across components and pages */
export type Page = {
  slug: string
  name: string
  html: string
  /** Label shown in the site navigation menu (defaults to name) */
  menuLabel?: string
  /** Whether this page appears in the nav menu (defaults to true) */
  inMenu?: boolean
}
