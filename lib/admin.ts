export const ADMIN_EMAIL = 'info@factulista.com'

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return email.trim().toLowerCase() === ADMIN_EMAIL
}
