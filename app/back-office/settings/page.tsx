'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LANGUAGES, type Language } from '../../../lib/i18n/languages'
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'

const C = {
  bg: '#faf9f7',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  white: '#ffffff',
  border: '#e8e4de',
  blue: '#2563eb',
  green: '#10b981',
}

export default function SettingsPage() {
  const { language, setLanguage, loaded } = useLanguage()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  if (!loaded) {
    return (
      <div style={{ padding: '32px 40px', color: C.textFaint, fontSize: '0.9rem' }}>
        {t('common.loading' as const, language)}
      </div>
    )
  }

  const handleLanguageChange = (newLanguage: Language) => {
    setLanguage(newLanguage)
    setSaved(true)
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '800px' }}>
      {/* Back link */}
      <Link href="/back-office" style={{ fontSize: '0.85rem', color: C.textMuted, textDecoration: 'none', display: 'inline-block', marginBottom: '20px' }}>
        ← {t('common.back' as const, language)}
      </Link>

      {/* Title */}
      <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: C.text, marginBottom: '6px' }}>
        {t('settings.title' as const, language)}
      </h1>
      <p style={{ margin: '0 0 32px', fontSize: '0.88rem', color: C.textMuted }}>
        {t('settings.selectLanguage' as const, language)}
      </p>

      {/* Language section */}
      <div style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
      }}>
        <h2 style={{ margin: '0 0 20px', fontSize: '0.95rem', fontWeight: 600, color: C.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('settings.language' as const, language)}
        </h2>

        {/* Languages grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
          {Object.entries(LANGUAGES).map(([langCode, langInfo]) => (
            <button
              key={langCode}
              onClick={() => handleLanguageChange(langCode as Language)}
              style={{
                padding: '16px 14px',
                border: `2px solid ${language === langCode ? C.blue : C.border}`,
                borderRadius: '10px',
                background: language === langCode ? '#eff6ff' : C.white,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                if (language !== langCode) {
                  (e.currentTarget as HTMLElement).style.borderColor = C.textMuted
                  ;(e.currentTarget as HTMLElement).style.background = '#fafafa'
                }
              }}
              onMouseLeave={e => {
                if (language !== langCode) {
                  (e.currentTarget as HTMLElement).style.borderColor = C.border
                  ;(e.currentTarget as HTMLElement).style.background = C.white
                }
              }}
            >
              <span style={{ fontSize: '1.5rem' }}>
                {langInfo.flag}
              </span>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: language === langCode ? 600 : 500,
                color: language === langCode ? C.blue : C.text,
              }}>
                {langInfo.name}
              </span>
              {language === langCode && (
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: C.blue,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginTop: '4px',
                }}>
                  ✓ {t('common.save' as const, language)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Saved notification */}
      {saved && (
        <div style={{
          background: '#f0fdf4',
          border: `1px solid #86efac`,
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '0.85rem',
          color: '#166534',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>✓</span>
          <span>{t('settings.saved' as const, language)}</span>
        </div>
      )}

      {/* Info section */}
      <div style={{
        background: '#fef3c7',
        border: '1px solid #fcd34d',
        borderRadius: '8px',
        padding: '14px 16px',
        marginTop: '24px',
        fontSize: '0.8rem',
        color: '#92400e',
      }}>
        <p style={{ margin: 0 }}>
          {language === 'it' && 'La lingua selezionata sarà salvata e applicata a tutta l\'applicazione.'}
          {language === 'en' && 'Your selected language will be saved and applied throughout the application.'}
          {language === 'es' && 'Tu idioma seleccionado se guardará y se aplicará en toda la aplicación.'}
          {language === 'fr' && 'Votre langue sélectionnée sera enregistrée et appliquée dans toute l\'application.'}
          {language === 'de' && 'Ihre ausgewählte Sprache wird gespeichert und auf die gesamte Anwendung angewendet.'}
          {language === 'nl' && 'Uw geselecteerde taal wordt opgeslagen en toegepast op de gehele toepassing.'}
          {language === 'pt' && 'Seu idioma selecionado será salvo e aplicado em todo o aplicativo.'}
        </p>
      </div>
    </div>
  )
}
