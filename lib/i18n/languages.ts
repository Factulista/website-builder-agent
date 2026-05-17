export const LANGUAGES = {
  it: { name: 'Italiano', flag: '🇮🇹' },
  en: { name: 'English', flag: '🇬🇧' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  nl: { name: 'Nederlands', flag: '🇳🇱' },
  pt: { name: 'Português', flag: '🇵🇹' },
} as const

export type Language = keyof typeof LANGUAGES

export const DEFAULT_LANGUAGE: Language = 'it'
