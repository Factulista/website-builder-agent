export const SAAS2_TEMPLATE = `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{meta_title}}</title>
  <meta name="description" content="{{meta_description}}">
  <meta property="og:title" content="{{meta_title}}">
  <meta property="og:description" content="{{meta_description}}">
  <meta property="og:type" content="website">
  <link rel="canonical" href="{{canonical_url}}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent: {{primary_color}};
      --primary: #000000;
      --primary-fg: #ffffff;
      --text: #000000;
      --text-mid: #333333;
      --text-muted: #737373;
      --surface: #ffffff;
      --surface-alt: #f5f5f5;
      --border: #000000;
      --border-light: #e5e5e5;
      --radius-card: 12px;
      --radius-btn: 0px;
      --font: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
    }

    body {
      font-family: var(--font);
      background: var(--surface);
      color: var(--text);
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }

    /* ── NAVBAR ── */
    nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 200;
      background: rgba(255,255,255,0.8);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid #000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 40px;
      height: 64px;
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      flex-shrink: 0;
    }

    .nav-logo-mark {
      width: 32px;
      height: 32px;
      background: #000;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
    }

    .nav-logo-text {
      font-size: 1.05rem;
      font-weight: 700;
      color: #000;
      letter-spacing: -0.3px;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 6px;
      list-style: none;
    }

    .nav-links a {
      text-decoration: none;
      color: #737373;
      font-size: 16px;
      font-weight: 500;
      font-family: var(--font);
      padding: 6px 14px;
      border-radius: 0;
      transition: color 0.2s;
    }

    .nav-links a:hover {
      color: #000;
    }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .btn-ghost-nav {
      background: transparent;
      border: none;
      color: #000;
      padding: 8px 16px;
      border-radius: 0;
      font-size: 0.88rem;
      font-weight: 500;
      font-family: var(--font);
      cursor: pointer;
      text-decoration: none;
      transition: color 0.2s;
    }

    .btn-ghost-nav:hover {
      color: #737373;
    }

    .btn-accent-nav {
      background: #000;
      color: #fff;
      padding: 8px 16px;
      border-radius: 0;
      font-size: 0.88rem;
      font-weight: 500;
      font-family: var(--font);
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: opacity 0.2s;
    }

    .btn-accent-nav:hover {
      opacity: 0.85;
    }

    /* Hamburger */
    .hamburger {
      display: none;
      flex-direction: column;
      gap: 5px;
      cursor: pointer;
      padding: 6px;
      background: none;
      border: none;
    }

    .hamburger span {
      display: block;
      width: 22px;
      height: 2px;
      background: #000;
      border-radius: 0;
      transition: transform 0.25s, opacity 0.25s;
    }

    .mobile-menu {
      display: none;
      position: fixed;
      inset: 64px 0 0 0;
      background: #fff;
      border-bottom: 1px solid #000;
      z-index: 199;
      flex-direction: column;
      padding: 24px 24px;
      gap: 8px;
      overflow-y: auto;
    }

    .mobile-menu.open { display: flex; }

    .mobile-menu a {
      text-decoration: none;
      color: #000;
      font-size: 1rem;
      font-weight: 500;
      padding: 12px 16px;
      border-radius: 0;
      border: 1px solid #e5e5e5;
      transition: background 0.2s;
    }

    .mobile-menu a:hover { background: #f5f5f5; }

    .mobile-menu .btn-accent-nav {
      text-align: center;
      margin-top: 8px;
    }

    /* ── HERO ── */
    .hero {
      position: relative;
      overflow: hidden;
      background: #ffffff;
      padding-top: 64px;
      padding-bottom: 110px;
      padding-left: 40px;
      padding-right: 40px;
      text-align: center;
    }

    .hero-grid-bg {
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px);
      background-size: 48px 48px;
      pointer-events: none;
    }

    .hero-inner {
      position: relative;
      z-index: 1;
      max-width: 760px;
      margin: 0 auto;
      padding-top: 56px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: #f5f5f5;
      color: #000;
      border: 1px solid #000;
      padding: 5px 14px 5px 10px;
      border-radius: 0;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      margin-bottom: 28px;
    }

    .badge-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      flex-shrink: 0;
    }

    .hero h1 {
      font-size: clamp(2.6rem, 5.5vw, 3.75rem);
      font-weight: 700;
      line-height: 1.0;
      letter-spacing: -0.02em;
      color: var(--text);
      margin-bottom: 22px;
    }

    .hero h1 .highlight {
      color: var(--accent);
    }

    .hero-sub {
      font-size: 1.15rem;
      color: #737373;
      max-width: 560px;
      margin: 0 auto 36px;
      line-height: 1.7;
    }

    .hero-ctas {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }

    .btn-primary {
      background: #000;
      color: #fff;
      padding: 13px 28px;
      border-radius: 0;
      font-size: 0.97rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      border: none;
      transition: opacity 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-primary:hover {
      opacity: 0.85;
    }

    .btn-secondary {
      background: #f5f5f5;
      color: #000;
      padding: 13px 28px;
      border-radius: 0;
      font-size: 0.97rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid #000;
      transition: background 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-secondary:hover {
      background: #e5e5e5;
    }

    .social-proof {
      font-size: 0.88rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      flex-wrap: wrap;
    }

    .social-proof-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .social-proof-check {
      color: var(--accent);
      font-weight: 700;
    }

    /* Hero browser mockup */
    .hero-mockup {
      position: relative;
      z-index: 1;
      max-width: 820px;
      margin: 56px auto 0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 3px 3px 0 0 #000;
      border: 1px solid #000;
    }

    .mockup-bar {
      background: #f5f5f5;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #000;
    }

    .mockup-dots {
      display: flex;
      gap: 6px;
    }

    .mockup-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
    }

    .mockup-dot:nth-child(1) { background: #fc5c5c; }
    .mockup-dot:nth-child(2) { background: #fdbc40; }
    .mockup-dot:nth-child(3) { background: #33c748; }

    .mockup-url {
      flex: 1;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 0;
      padding: 4px 12px;
      font-size: 0.78rem;
      color: #737373;
      max-width: 380px;
      margin: 0 auto;
    }

    .mockup-body {
      background: #fff;
      padding: 28px;
      min-height: 180px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .mockup-row {
      height: 12px;
      border-radius: 6px;
      background: #f5f5f5;
    }

    .mockup-row.accent { background: var(--accent); opacity: 0.2; width: 40%; }
    .mockup-row.wide { width: 80%; }
    .mockup-row.medium { width: 60%; }
    .mockup-row.short { width: 30%; }

    .mockup-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 6px;
    }

    .mockup-card {
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .mockup-card-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #e5e5e5;
    }

    .mockup-card-line {
      height: 8px;
      background: #e5e5e5;
      border-radius: 4px;
    }

    .mockup-card-line.short { width: 55%; }

    /* ── SECTION SHARED ── */
    section { padding: 96px 40px; }

    .section-label {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--accent);
      margin-bottom: 12px;
    }

    .section-title {
      font-size: clamp(1.7rem, 3.5vw, 2.4rem);
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.2;
      color: var(--text);
      margin-bottom: 14px;
    }

    .section-sub {
      font-size: 1.05rem;
      color: var(--text-mid);
      max-width: 560px;
      line-height: 1.7;
    }

    .section-header { margin-bottom: 56px; }
    .section-header.center { text-align: center; }
    .section-header.center .section-sub { margin: 0 auto; }

    .container { max-width: 1120px; margin: 0 auto; }

    /* ── COMPARISON SECTION ── */
    .comparison {
      background: var(--surface-alt);
      border-top: 1px solid #e5e5e5;
      border-bottom: 1px solid #e5e5e5;
    }

    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }

    .comparison-card {
      background: var(--surface);
      border: 1px solid #000;
      border-radius: 12px;
      padding: 40px 36px;
      position: relative;
      box-shadow: 3px 3px 0 0 #000;
    }

    .comparison-card.featured {
      border: 2px solid #000;
      box-shadow: 5px 5px 0 0 #000;
    }

    .card-recommended {
      position: absolute;
      top: -14px;
      left: 36px;
      background: #000;
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 0;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .comparison-icon {
      width: 52px;
      height: 52px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 22px;
    }

    .comparison-icon.accent-bg {
      background: var(--surface-alt);
    }

    .comparison-icon.neutral-bg {
      background: var(--surface-alt);
    }

    .comparison-card h3 {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .comparison-card .card-subtitle {
      font-size: 0.93rem;
      color: var(--text-muted);
      margin-bottom: 28px;
      line-height: 1.6;
    }

    .comparison-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .comparison-list li {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      font-size: 0.93rem;
      color: var(--text-mid);
    }

    .comparison-list li .check {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }

    .comparison-list li .check.yes {
      background: #f5f5f5;
      color: var(--accent);
    }

    .comparison-list li .check.no {
      background: #f5f5f5;
      color: #737373;
    }

    /* ── FEATURES GRID ── */
    .features { background: var(--surface); }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      overflow: hidden;
    }

    .feature-card {
      background: var(--surface);
      padding: 36px 32px;
      border-right: 1px solid #e5e5e5;
      border-bottom: 1px solid #e5e5e5;
      transition: background 0.2s;
      position: relative;
    }

    .feature-card:hover { background: #f5f5f5; }

    .feature-card:nth-child(3n) { border-right: none; }
    .feature-card:nth-last-child(-n+3) { border-bottom: none; }

    .feature-icon {
      width: 46px;
      height: 46px;
      background: var(--surface-alt);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 18px;
      flex-shrink: 0;
    }

    .feature-icon svg {
      width: 22px;
      height: 22px;
      stroke: #000;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .feature-card h4 {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }

    .feature-card p {
      font-size: 0.89rem;
      color: var(--text-muted);
      line-height: 1.65;
    }

    /* ── STATS BAR ── */
    .stats {
      background: #000;
      padding: 56px 40px;
    }

    .stats-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 32px;
      text-align: center;
    }

    .stat-item {}

    .stat-number {
      font-size: 2.4rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.03em;
      line-height: 1;
      margin-bottom: 6px;
    }

    .stat-number span { color: var(--accent); }

    .stat-label {
      font-size: 0.88rem;
      color: rgba(255,255,255,0.55);
      font-weight: 500;
    }

    /* ── PRICING ── */
    .pricing { background: var(--surface-alt); }

    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
      max-width: 840px;
      margin: 0 auto;
    }

    .pricing-card {
      background: var(--surface);
      border: 1px solid #000;
      border-radius: 12px;
      padding: 40px 36px;
      position: relative;
      box-shadow: 3px 3px 0 0 #000;
    }

    .pricing-card.recommended {
      border: 2px solid #000;
      box-shadow: 5px 5px 0 0 #000;
    }

    .pricing-badge {
      position: absolute;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      background: #000;
      color: #fff;
      font-size: 0.73rem;
      font-weight: 700;
      padding: 4px 14px;
      border-radius: 0;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .pricing-plan-name {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 16px;
    }

    .pricing-price {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-bottom: 8px;
    }

    .pricing-price .amount {
      font-size: 3rem;
      font-weight: 900;
      color: var(--text);
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .pricing-price .currency {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-mid);
      margin-bottom: 4px;
    }

    .pricing-price .period {
      font-size: 0.88rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .pricing-desc {
      font-size: 0.88rem;
      color: var(--text-muted);
      margin-bottom: 28px;
      padding-bottom: 28px;
      border-bottom: 1px solid #e5e5e5;
      line-height: 1.6;
    }

    .pricing-features {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 11px;
      margin-bottom: 32px;
    }

    .pricing-features li {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.91rem;
    }

    .pricing-features li.included { color: var(--text-mid); }
    .pricing-features li.excluded { color: var(--text-muted); }

    .pricing-features li .pf-icon {
      flex-shrink: 0;
      font-size: 0.95rem;
      font-weight: 700;
    }

    .pricing-features li.included .pf-icon { color: var(--accent); }
    .pricing-features li.excluded .pf-icon { color: #737373; }

    .btn-outline {
      display: block;
      text-align: center;
      text-decoration: none;
      border: 1px solid #000;
      background: #f5f5f5;
      color: #000;
      padding: 12px 24px;
      border-radius: 0;
      font-size: 0.93rem;
      font-weight: 500;
      transition: background 0.2s;
    }

    .btn-outline:hover {
      background: #e5e5e5;
    }

    .btn-full {
      display: block;
      text-align: center;
      text-decoration: none;
      background: #000;
      color: #fff;
      padding: 12px 24px;
      border-radius: 0;
      border: none;
      font-size: 0.93rem;
      font-weight: 500;
      transition: opacity 0.2s;
    }

    .btn-full:hover {
      opacity: 0.85;
    }

    /* ── CTA BANNER ── */
    .cta-banner {
      background: #000;
      padding: 100px 40px;
      text-align: center;
    }

    .cta-inner {
      max-width: 640px;
      margin: 0 auto;
    }

    .cta-banner h2 {
      font-size: clamp(1.8rem, 3.5vw, 2.6rem);
      font-weight: 900;
      color: #fff;
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin-bottom: 16px;
    }

    .cta-banner p {
      font-size: 1.05rem;
      color: rgba(255,255,255,0.65);
      margin-bottom: 36px;
      line-height: 1.7;
    }

    .cta-banner .btn-primary {
      background: #fff;
      color: #000;
      border: none;
    }

    .cta-banner .btn-primary:hover {
      opacity: 0.85;
    }

    /* ── CONTACT FORM ── */
    .contact {
      background: var(--surface);
    }

    .contact-wrap {
      display: grid;
      grid-template-columns: 1fr 1.4fr;
      gap: 80px;
      align-items: start;
    }

    .contact-info h3 {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 14px;
    }

    .contact-info p {
      font-size: 0.93rem;
      color: var(--text-muted);
      line-height: 1.7;
      margin-bottom: 32px;
    }

    .contact-detail {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .contact-detail-icon {
      width: 38px;
      height: 38px;
      background: #f5f5f5;
      border-radius: 8px;
      border: 1px solid #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .contact-detail-icon svg {
      width: 18px;
      height: 18px;
      stroke: #000;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .contact-detail-text {
      font-size: 0.9rem;
      color: var(--text-mid);
      font-weight: 500;
    }

    .contact-form {
      background: #f5f5f5;
      border: 1px solid #000;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 3px 3px 0 0 #000;
    }

    .form-group {
      margin-bottom: 18px;
    }

    .form-group label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-mid);
      margin-bottom: 6px;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      background: #fff;
      border: 1px solid #000;
      border-radius: 0;
      height: 48px;
      padding: 8px 12px;
      font-size: 0.92rem;
      font-family: var(--font);
      color: var(--text);
      transition: border-color 0.2s, box-shadow 0.2s;
      outline: none;
    }

    .form-group textarea {
      height: auto;
      min-height: 130px;
      resize: vertical;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      border-color: #000;
      box-shadow: 3px 3px 0 0 var(--accent);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .btn-submit {
      width: 100%;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 0;
      padding: 13px 24px;
      font-size: 0.95rem;
      font-weight: 500;
      font-family: var(--font);
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .btn-submit:hover {
      opacity: 0.85;
    }

    /* ── FOOTER ── */
    footer {
      background: #fff;
      border-top: 1px solid #000;
      color: #737373;
      padding: 64px 40px 0;
    }

    .footer-grid {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1.6fr 1fr 1fr 1fr;
      gap: 48px;
      padding-bottom: 48px;
    }

    .footer-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      margin-bottom: 16px;
    }

    .footer-logo-mark {
      width: 30px;
      height: 30px;
      background: #000;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.82rem;
      font-weight: 800;
      color: #fff;
    }

    .footer-logo-text {
      font-size: 1rem;
      font-weight: 700;
      color: #000;
    }

    .footer-desc {
      font-size: 0.87rem;
      line-height: 1.7;
      color: #737373;
      margin-bottom: 24px;
    }

    .footer-socials {
      display: flex;
      gap: 10px;
    }

    .footer-social-btn {
      width: 36px;
      height: 36px;
      background: #f5f5f5;
      border-radius: 0;
      border: 1px solid #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: background 0.2s;
    }

    .footer-social-btn:hover { background: #e5e5e5; }

    .footer-social-btn svg {
      width: 16px;
      height: 16px;
      fill: #000;
    }

    .footer-col h5 {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #737373;
      margin-bottom: 18px;
    }

    .footer-links {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .footer-links a {
      text-decoration: none;
      color: #737373;
      font-size: 0.88rem;
      transition: color 0.2s;
    }

    .footer-links a:hover { color: #fbbf24; }

    .footer-bottom {
      max-width: 1120px;
      margin: 0 auto;
      border-top: 1px solid #e5e5e5;
      padding: 22px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .footer-bottom p {
      font-size: 0.82rem;
      color: #737373;
    }

    .footer-bottom a {
      text-decoration: none;
      color: #737373;
      font-size: 0.82rem;
      transition: color 0.2s;
    }

    .footer-bottom a:hover { color: #fbbf24; }

    .footer-bottom-links {
      display: flex;
      gap: 20px;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 1024px) {
      .features-grid { grid-template-columns: repeat(2, 1fr); }
      .feature-card:nth-child(3n) { border-right: 1px solid #e5e5e5; }
      .feature-card:nth-child(2n) { border-right: none; }
      .feature-card:nth-last-child(-n+3) { border-bottom: 1px solid #e5e5e5; }
      .feature-card:nth-last-child(-n+2) { border-bottom: none; }
      .stats-inner { grid-template-columns: repeat(2, 1fr); }
      .footer-grid { grid-template-columns: 1fr 1fr; }
      .contact-wrap { grid-template-columns: 1fr; gap: 48px; }
    }

    @media (max-width: 768px) {
      nav { padding: 0 20px; }
      .nav-links, .nav-actions { display: none; }
      .hamburger { display: flex; }

      section { padding: 64px 20px; }
      .hero { padding-top: 64px; padding-bottom: 80px; padding-left: 20px; padding-right: 20px; }

      .hero h1 { font-size: 2.2rem; }
      .hero-sub { font-size: 1rem; }
      .hero-ctas { flex-direction: column; align-items: stretch; }
      .btn-primary, .btn-secondary { justify-content: center; }

      .comparison-grid { grid-template-columns: 1fr; }
      .comparison-card { padding: 32px 24px; }

      .features-grid { grid-template-columns: 1fr; border-radius: 12px; }
      .feature-card { border-right: none !important; }
      .feature-card:nth-last-child(1) { border-bottom: none !important; }
      .feature-card:nth-last-child(-n+2) { border-bottom: 1px solid #e5e5e5 !important; }

      .stats { padding: 48px 20px; }
      .stats-inner { grid-template-columns: repeat(2, 1fr); gap: 24px; }
      .stat-number { font-size: 2rem; }

      .pricing-grid { grid-template-columns: 1fr; max-width: 440px; }
      .pricing-card { padding: 32px 24px; }

      .cta-banner { padding: 72px 20px; }

      .contact { }
      .contact-wrap { gap: 36px; }
      .contact-form { padding: 28px 20px; }
      .form-row { grid-template-columns: 1fr; }

      footer { padding: 48px 20px 0; }
      .footer-grid { grid-template-columns: 1fr; gap: 36px; }
      .footer-bottom { flex-direction: column; align-items: flex-start; }
      .footer-bottom-links { flex-wrap: wrap; gap: 14px; }

      .mockup-cards { grid-template-columns: 1fr; }
      .hero-mockup { display: none; }
    }

    @media (max-width: 480px) {
      .stats-inner { grid-template-columns: 1fr; }
      .social-proof { flex-direction: column; gap: 8px; }
    }
  </style>
</head>
<body>

<!-- ── NAVBAR ── -->
<nav>
  <a href="#" class="nav-logo" aria-label="{{company_name}}">
    <div class="nav-logo-mark">{{company_name_initial}}</div>
    <span class="nav-logo-text">{{company_name}}</span>
  </a>

  <ul class="nav-links">
    <li><a href="#features">{{nav_link_1}}</a></li>
    <li><a href="#pricing">{{nav_link_2}}</a></li>
    <li><a href="#contact">{{nav_link_3}}</a></li>
  </ul>

  <div class="nav-actions">
    <a href="#" class="btn-ghost-nav">{{nav_login}}</a>
    <a href="#" class="btn-accent-nav">{{cta_primary}}</a>
  </div>

  <button class="hamburger" id="hamburgerBtn" aria-label="Menu" aria-expanded="false">
    <span></span>
    <span></span>
    <span></span>
  </button>
</nav>

<!-- Mobile menu -->
<div class="mobile-menu" id="mobileMenu" role="navigation">
  <a href="#features">{{nav_link_1}}</a>
  <a href="#pricing">{{nav_link_2}}</a>
  <a href="#contact">{{nav_link_3}}</a>
  <a href="#" class="btn-ghost-nav" style="text-align:center;margin-top:8px;">{{nav_login}}</a>
  <a href="#" class="btn-accent-nav">{{cta_primary}}</a>
</div>

<!-- ── HERO ── -->
<section class="hero" id="home">
  <div class="hero-grid-bg"></div>
  <div class="hero-inner">
    <div class="badge">
      <span class="badge-dot"></span>
      {{badge_text}}
    </div>
    <h1>{{tagline}}</h1>
    <p class="hero-sub">{{subtitle}}</p>
    <div class="hero-ctas">
      <a href="#" class="btn-primary">
        {{cta_primary}}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
      <a href="#features" class="btn-secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
        {{cta_secondary}}
      </a>
    </div>
    <div class="social-proof">
      <span class="social-proof-item"><span class="social-proof-check">✓</span> {{social_proof}}</span>
    </div>
  </div>

  <!-- App mockup preview -->
  <div class="hero-mockup" aria-hidden="true">
    <div class="mockup-bar">
      <div class="mockup-dots">
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
      </div>
      <div class="mockup-url">app.{{company_name_lower}}.com/dashboard</div>
    </div>
    <div class="mockup-body">
      <div class="mockup-row accent"></div>
      <div class="mockup-row wide"></div>
      <div class="mockup-row medium"></div>
      <div class="mockup-cards">
        <div class="mockup-card">
          <div class="mockup-card-icon"></div>
          <div class="mockup-card-line"></div>
          <div class="mockup-card-line short"></div>
        </div>
        <div class="mockup-card">
          <div class="mockup-card-icon"></div>
          <div class="mockup-card-line"></div>
          <div class="mockup-card-line short"></div>
        </div>
        <div class="mockup-card">
          <div class="mockup-card-icon"></div>
          <div class="mockup-card-line"></div>
          <div class="mockup-card-line short"></div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ── STATS BAR ── -->
<div class="stats" aria-label="Statistics">
  <div class="stats-inner">
    <div class="stat-item">
      <div class="stat-number">{{stat_1_number}}</div>
      <div class="stat-label">{{stat_1_label}}</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">{{stat_2_number}}</div>
      <div class="stat-label">{{stat_2_label}}</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">{{stat_3_number}}</div>
      <div class="stat-label">{{stat_3_label}}</div>
    </div>
    <div class="stat-item">
      <div class="stat-number">{{stat_4_number}}</div>
      <div class="stat-label">{{stat_4_label}}</div>
    </div>
  </div>
</div>

<!-- ── COMPARISON SECTION ── -->
<section class="comparison" id="modes">
  <div class="container">
    <div class="section-header center">
      <span class="section-label">{{section_modes_label}}</span>
      <h2 class="section-title">{{section_modes_title}}</h2>
      <p class="section-sub">{{section_modes_sub}}</p>
    </div>
    <div class="comparison-grid">
      <!-- Card 1: Featured -->
      <div class="comparison-card featured">
        <div class="card-recommended">{{recommended_badge}}</div>
        <div class="comparison-icon accent-bg">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <h3>{{mode_1_title}}</h3>
        <p class="card-subtitle">{{mode_1_subtitle}}</p>
        <ul class="comparison-list">
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_1_feature_1}}
          </li>
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_1_feature_2}}
          </li>
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_1_feature_3}}
          </li>
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_1_feature_4}}
          </li>
        </ul>
      </div>

      <!-- Card 2: Neutral -->
      <div class="comparison-card">
        <div class="comparison-icon neutral-bg">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
        </div>
        <h3>{{mode_2_title}}</h3>
        <p class="card-subtitle">{{mode_2_subtitle}}</p>
        <ul class="comparison-list">
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_2_feature_1}}
          </li>
          <li>
            <span class="check yes">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </span>
            {{mode_2_feature_2}}
          </li>
          <li>
            <span class="check no">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </span>
            {{mode_2_feature_3}}
          </li>
          <li>
            <span class="check no">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </span>
            {{mode_2_feature_4}}
          </li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ── FEATURES GRID ── -->
<section class="features" id="features">
  <div class="container">
    <div class="section-header center">
      <span class="section-label">{{section_features_label}}</span>
      <h2 class="section-title">{{section_features_title}}</h2>
      <p class="section-sub">{{section_features_sub}}</p>
    </div>

    <div class="features-grid">
      <!-- Feature 1 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <h4>{{feature_1_title}}</h4>
        <p>{{feature_1_desc}}</p>
      </div>

      <!-- Feature 2 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <h4>{{feature_2_title}}</h4>
        <p>{{feature_2_desc}}</p>
      </div>

      <!-- Feature 3 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </div>
        <h4>{{feature_3_title}}</h4>
        <p>{{feature_3_desc}}</p>
      </div>

      <!-- Feature 4 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h4>{{feature_4_title}}</h4>
        <p>{{feature_4_desc}}</p>
      </div>

      <!-- Feature 5 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        </div>
        <h4>{{feature_5_title}}</h4>
        <p>{{feature_5_desc}}</p>
      </div>

      <!-- Feature 6 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <h4>{{feature_6_title}}</h4>
        <p>{{feature_6_desc}}</p>
      </div>

      <!-- Feature 7 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        </div>
        <h4>{{feature_7_title}}</h4>
        <p>{{feature_7_desc}}</p>
      </div>

      <!-- Feature 8 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h4>{{feature_8_title}}</h4>
        <p>{{feature_8_desc}}</p>
      </div>

      <!-- Feature 9 -->
      <div class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <h4>{{feature_9_title}}</h4>
        <p>{{feature_9_desc}}</p>
      </div>
    </div>
  </div>
</section>

<!-- ── PRICING ── -->
<section class="pricing" id="pricing">
  <div class="container">
    <div class="section-header center">
      <span class="section-label">{{section_pricing_label}}</span>
      <h2 class="section-title">{{section_pricing_title}}</h2>
      <p class="section-sub">{{section_pricing_sub}}</p>
    </div>

    <div class="pricing-grid">
      <!-- Free Plan -->
      <div class="pricing-card">
        <div class="pricing-plan-name">{{price_free_label}}</div>
        <div class="pricing-price">
          <span class="amount">€0</span>
          <span class="period">/ {{price_paid_period}}</span>
        </div>
        <p class="pricing-desc">{{price_free_desc}}</p>
        <ul class="pricing-features">
          <li class="included"><span class="pf-icon">✓</span> {{plan_free_1}}</li>
          <li class="included"><span class="pf-icon">✓</span> {{plan_free_2}}</li>
          <li class="included"><span class="pf-icon">✓</span> {{plan_free_3}}</li>
          <li class="excluded"><span class="pf-icon">–</span> {{plan_free_4}}</li>
          <li class="excluded"><span class="pf-icon">–</span> {{plan_free_5}}</li>
        </ul>
        <a href="#" class="btn-outline">{{cta_free}}</a>
      </div>

      <!-- PRO Plan -->
      <div class="pricing-card recommended">
        <div class="pricing-badge">{{pricing_popular_badge}}</div>
        <div class="pricing-plan-name">{{price_paid_label}}</div>
        <div class="pricing-price">
          <span class="currency">€</span>
          <span class="amount">{{price_paid}}</span>
          <span class="period">/ {{price_paid_period}}</span>
        </div>
        <p class="pricing-desc">{{price_paid_desc}}</p>
        <ul class="pricing-features">
          <li class="included"><span class="pf-icon">✓</span> {{plan_pro_1}}</li>
          <li class="included"><span class="pf-icon">✓</span> {{plan_pro_2}}</li>
          <li class="included"><span class="pf-icon">✓</span> {{plan_pro_3}}</li>
          <li class="excluded"><span class="pf-icon">–</span> {{plan_pro_4}}</li>
          <li class="excluded"><span class="pf-icon">–</span> {{plan_pro_5}}</li>
        </ul>
        <a href="#" class="btn-full">{{cta_primary}}</a>
      </div>
    </div>
  </div>
</section>

<!-- ── CTA BANNER ── -->
<section class="cta-banner">
  <div class="cta-inner">
    <h2>{{cta_banner_title}}</h2>
    <p>{{cta_banner_desc}}</p>
    <a href="#" class="btn-primary" style="display:inline-flex;">
      {{cta_primary}}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>
  </div>
</section>

<!-- ── CONTACT FORM ── -->
<section class="contact" id="contact">
  <div class="container">
    <div class="contact-wrap">
      <!-- Left: info -->
      <div class="contact-info">
        <span class="section-label">{{section_contact_label}}</span>
        <h2 class="section-title" style="margin-bottom:14px;">{{section_contact_title}}</h2>
        <p>{{section_contact_desc}}</p>

        <div class="contact-detail">
          <div class="contact-detail-icon">
            <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <span class="contact-detail-text">info@{{company_name_lower}}.com</span>
        </div>

        <div class="contact-detail">
          <div class="contact-detail-icon">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </div>
          <span class="contact-detail-text">{{contact_phone}}</span>
        </div>

        <div class="contact-detail">
          <div class="contact-detail-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <span class="contact-detail-text">{{contact_response_time}}</span>
        </div>
      </div>

      <!-- Right: form -->
      <div class="contact-form">
        <form action="#" method="post" novalidate>
          <div class="form-row">
            <div class="form-group">
              <label for="contact-name">{{form_name_label}}</label>
              <input type="text" id="contact-name" name="name" placeholder="{{form_name_placeholder}}" autocomplete="name">
            </div>
            <div class="form-group">
              <label for="contact-email">{{form_email_label}}</label>
              <input type="email" id="contact-email" name="email" placeholder="{{form_email_placeholder}}" autocomplete="email">
            </div>
          </div>
          <div class="form-group">
            <label for="contact-company">{{form_company_label}}</label>
            <input type="text" id="contact-company" name="company" placeholder="{{form_company_placeholder}}" autocomplete="organization">
          </div>
          <div class="form-group">
            <label for="contact-message">{{form_message_label}}</label>
            <textarea id="contact-message" name="message" placeholder="{{form_message_placeholder}}"></textarea>
          </div>
          <button type="submit" class="btn-submit">{{form_submit_label}}</button>
        </form>
      </div>
    </div>
  </div>
</section>

<!-- ── FOOTER ── -->
<footer>
  <div class="footer-grid">
    <!-- Col 1: Brand -->
    <div>
      <a href="#" class="footer-logo" aria-label="{{company_name}}">
        <div class="footer-logo-mark">{{company_name_initial}}</div>
        <span class="footer-logo-text">{{company_name}}</span>
      </a>
      <p class="footer-desc">{{subtitle}}</p>
      <div class="footer-socials">
        <!-- Twitter/X -->
        <a href="#" class="footer-social-btn" aria-label="Twitter">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <!-- LinkedIn -->
        <a href="#" class="footer-social-btn" aria-label="LinkedIn">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
        <!-- GitHub -->
        <a href="#" class="footer-social-btn" aria-label="GitHub">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
        </a>
      </div>
    </div>

    <!-- Col 2: Product links -->
    <div class="footer-col">
      <h5>{{footer_col1_title}}</h5>
      <ul class="footer-links">
        <li><a href="#features">{{nav_link_1}}</a></li>
        <li><a href="#pricing">{{nav_link_2}}</a></li>
        <li><a href="#modes">{{footer_modes_link}}</a></li>
        <li><a href="#">{{footer_docs_link}}</a></li>
        <li><a href="#">{{footer_changelog_link}}</a></li>
      </ul>
    </div>

    <!-- Col 3: Company links -->
    <div class="footer-col">
      <h5>{{footer_col2_title}}</h5>
      <ul class="footer-links">
        <li><a href="#">{{footer_about_link}}</a></li>
        <li><a href="#">{{footer_blog_link}}</a></li>
        <li><a href="#">{{footer_careers_link}}</a></li>
        <li><a href="#contact">{{nav_link_3}}</a></li>
        <li><a href="#">{{footer_partner_link}}</a></li>
      </ul>
    </div>

    <!-- Col 4: Legal links -->
    <div class="footer-col">
      <h5>{{footer_col3_title}}</h5>
      <ul class="footer-links">
        <li><a href="#">{{footer_privacy_link}}</a></li>
        <li><a href="#">{{footer_terms_link}}</a></li>
        <li><a href="#">{{footer_cookie_link}}</a></li>
        <li><a href="#">{{footer_gdpr_link}}</a></li>
        <li><a href="#">{{footer_security_link}}</a></li>
      </ul>
    </div>
  </div>

  <div class="footer-bottom">
    <p>&copy; 2025 {{company_name}}. {{footer_rights}}</p>
    <div class="footer-bottom-links">
      <a href="#">{{footer_privacy_short}}</a>
      <a href="#">{{footer_terms_short}}</a>
      <a href="#">{{footer_cookie_short}}</a>
    </div>
  </div>
</footer>

<script>
  (function() {
    var btn = document.getElementById('hamburgerBtn');
    var menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;

    btn.addEventListener('click', function() {
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });

    menu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  })();
</script>

</body>
</html>`
