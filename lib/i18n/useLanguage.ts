'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_LANGUAGE, type Language } from './languages'
import { translations, type TranslationKey, t } from './translations'

const LANGUAGE_STORAGE_KEY = 'factulista_language'

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE)
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && stored in translations) {
      setLanguageState(stored as Language)
    }
    setLoaded(true)
  }, [])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }

  const translate = (key: TranslationKey): string => {
    return t(key, language)
  }

  return {
    language,
    setLanguage,
    translate,
    loaded,
  }
}
