export const DESIGN_KNOWLEDGE = `
## KNOWLEDGE BASE DESIGN

### Palette per Settore
- Ristorante/Food: caldi (rosso #C0392B, arancio #E67E22, marrone #8B4513, verde #27AE60)
- Tech/SaaS: freddi (blu #2563EB, viola #7C3AED, grigio #1E293B)
- Luxury/Premium: scuri (nero #0A0A0A, oro #C9A84C, bianco #FAFAFA)
- Healthcare: puliti (blu chiaro #0EA5E9, verde menta #10B981, bianco #FFFFFF)
- Legal/Finance: formali (blu navy #1E3A5F, grigio scuro #374151, oro #B8860B)
- Wellness/Beauty: morbidi (rosa #F9A8D4, lavanda #A78BFA, crema #FEF3C7)

### Tipografia
- Ristorante/Luxury: Georgia, Playfair Display (serif per h), Inter (body)
- Tech/Modern: Inter, Plus Jakarta Sans, DM Sans (tutto sans-serif)
- Creative/Agency: Syne, Space Grotesk, Clash Display
- Regola: massimo 2 font (heading + body)

### Contrasto WCAG AA
- Testo normale (< 18px): ratio minimo 4.5:1
- Testo grande (≥ 18px bold o ≥ 24px): ratio minimo 3:1
- Tool: usa colori con contrasto già calcolato

### Spaziatura (8px grid)
- xs: 4px | sm: 8px | md: 16px | lg: 24px | xl: 32px | 2xl: 48px | 3xl: 64px
- Padding sezioni: 80px top/bottom desktop, 48px mobile
- Max-width contenuto: 1200px, centrato

### Componenti CSS Essenziali
- :root con CSS custom properties per tutti i token
- Reset: box-sizing border-box, margin/padding 0
- Button: padding 12px 24px, border-radius da token, transizione 0.2s
- Card: box-shadow 0 1px 3px rgba(0,0,0,0.1), border-radius, padding 24px
- Navbar: position sticky, backdrop-filter blur, z-index 100

### Mobile First
- Breakpoints: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)
- Stack su mobile, grid su desktop
- Font-size base: 16px (mai meno)
`
