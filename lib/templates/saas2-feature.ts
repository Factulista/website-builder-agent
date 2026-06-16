export const SAAS2_FEATURE_TEMPLATE = `<!DOCTYPE html>
<html lang="{{lang}}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{meta_title}}</title>
  <meta name="description" content="{{meta_description}}">
  <meta property="og:title" content="{{meta_title}}">
  <meta property="og:description" content="{{meta_description}}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="{{og_image}}">
  <link rel="canonical" href="{{canonical_url}}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent: {{primary_color}};
      --primary: #000000;
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
      top: 0; left: 0; right: 0;
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
      font-size: 0.95rem;
      font-weight: 500;
      font-family: var(--font);
      padding: 6px 14px;
      transition: color 0.2s;
    }

    .nav-links a:hover { color: #000; }
    .nav-links a.active { color: #000; font-weight: 600; }

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
      border-radius: var(--radius-btn);
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      font-family: var(--font);
      transition: color 0.2s;
    }

    .btn-ghost-nav:hover { color: #737373; }

    .btn-accent-nav {
      background: #000;
      color: #fff;
      padding: 8px 18px;
      border-radius: var(--radius-btn);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid #000;
      font-family: var(--font);
      transition: opacity 0.2s;
    }

    .btn-accent-nav:hover { opacity: 0.85; }

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
      transition: transform 0.25s, opacity 0.25s;
    }

    /* Mobile menu */
    .mobile-menu {
      display: none;
      position: fixed;
      inset: 64px 0 0 0;
      background: #fff;
      border-bottom: 1px solid #000;
      z-index: 199;
      flex-direction: column;
      padding: 24px;
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
      padding-bottom: 0;
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
      padding-top: 72px;
      padding-bottom: 56px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: #f5f5f5;
      color: #000;
      border: 1px solid #000;
      padding: 5px 14px 5px 10px;
      border-radius: var(--radius-btn);
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
      font-size: clamp(2.4rem, 5vw, 3.5rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.025em;
      color: var(--text);
      margin-bottom: 22px;
    }

    .hero h1 .highlight { color: var(--accent); }

    .hero-sub {
      font-size: 1.1rem;
      color: #737373;
      max-width: 540px;
      margin: 0 auto 36px;
      line-height: 1.75;
    }

    .hero-ctas {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    .btn-primary {
      background: #000;
      color: #fff;
      padding: 13px 28px;
      border-radius: var(--radius-btn);
      font-size: 0.97rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid #000;
      font-family: var(--font);
      transition: opacity 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-primary:hover { opacity: 0.85; }

    .btn-secondary {
      background: #f5f5f5;
      color: #000;
      padding: 13px 28px;
      border-radius: var(--radius-btn);
      font-size: 0.97rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid #000;
      font-family: var(--font);
      transition: background 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-secondary:hover { background: #e5e5e5; }

    .social-proof {
      font-size: 0.85rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
    }

    .social-proof-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .social-proof-check {
      color: var(--accent);
      font-weight: 700;
    }

    /* Hero browser mockup */
    .hero-mockup {
      position: relative;
      z-index: 1;
      max-width: 900px;
      margin: 56px auto 0;
      border-radius: var(--radius-card);
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

    .mockup-dots { display: flex; gap: 6px; }

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
      max-width: 360px;
      margin: 0 auto;
    }

    .mockup-body {
      background: #fff;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .mockup-row {
      height: 12px;
      border-radius: 6px;
      background: #f0f0f0;
    }

    .mockup-row.accent { background: var(--accent); opacity: 0.18; width: 40%; }
    .mockup-row.wide { width: 75%; }
    .mockup-row.medium { width: 55%; }
    .mockup-row.short { width: 28%; }

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

    /* ── TRUST LOGOS ── */
    .logos {
      background: var(--surface-alt);
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 40px 40px;
      text-align: center;
    }

    .logos-label {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 28px;
    }

    .logos-grid {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 48px;
      flex-wrap: wrap;
    }

    .logo-item {
      font-size: 1rem;
      font-weight: 800;
      color: #c0c0c0;
      letter-spacing: -0.3px;
    }

    /* ── SECTION SHARED ── */
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
      font-size: clamp(1.7rem, 3.2vw, 2.4rem);
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.15;
      color: var(--text);
      margin-bottom: 14px;
    }

    .section-sub {
      font-size: 1.05rem;
      color: var(--text-mid);
      max-width: 560px;
      line-height: 1.7;
    }

    .container { max-width: 1120px; margin: 0 auto; }

    /* ── FEATURE DEEP-DIVE BLOCKS ── */
    .features-section {
      padding: 96px 40px;
      background: var(--surface);
    }

    .feature-block {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 80px;
      align-items: center;
      margin-bottom: 100px;
      max-width: 1120px;
      margin-left: auto;
      margin-right: auto;
    }

    .feature-block:last-child { margin-bottom: 0; }

    .feature-block.flip { direction: rtl; }
    .feature-block.flip > * { direction: ltr; }

    /* Light card mockup */
    .feature-visual {
      background: var(--surface-alt);
      border: 1px solid #000;
      border-radius: var(--radius-card);
      box-shadow: 3px 3px 0 0 #000;
      aspect-ratio: 4/3;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    .feature-visual-inner {
      width: 84%;
      height: 84%;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .fv-row { display: flex; gap: 8px; align-items: center; }

    .fv-pill {
      height: 26px;
      border-radius: 100px;
      background: #f0f0f0;
      flex: 1;
    }

    .fv-pill.accent {
      background: var(--accent);
      opacity: 0.25;
      flex: 0 0 72px;
    }

    .fv-block {
      height: 72px;
      border-radius: 8px;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      flex: 1;
    }

    .fv-block.accent {
      background: color-mix(in srgb, var(--accent) 12%, #fff);
      border-color: color-mix(in srgb, var(--accent) 25%, transparent);
    }

    .fv-line {
      height: 7px;
      border-radius: 4px;
      background: #ececec;
      flex: 1;
    }

    .fv-line.short { flex: 0 0 35%; }

    .fv-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      flex: 1;
    }

    .fv-mini {
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .fv-mini-line {
      height: 5px;
      border-radius: 3px;
      background: #e5e5e5;
    }

    .fv-mini-val {
      font-size: 1.1rem;
      font-weight: 800;
      color: var(--text-mid);
    }

    .fv-mini-val.accent { color: var(--accent); }

    /* Feature points with check icons */
    .feature-points {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 18px;
      margin-top: 8px;
    }

    .feature-points li {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .fp-icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .fp-icon svg {
      width: 14px;
      height: 14px;
      stroke: var(--accent);
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .fp-title {
      font-weight: 700;
      color: var(--text);
      margin-bottom: 3px;
      font-size: 0.95rem;
    }

    .fp-desc {
      color: var(--text-muted);
      font-size: 0.88rem;
      line-height: 1.65;
    }

    .btn-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #000;
      color: #fff;
      padding: 12px 24px;
      border-radius: var(--radius-btn);
      font-size: 0.92rem;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid #000;
      font-family: var(--font);
      transition: opacity 0.2s;
    }

    .btn-cta:hover { opacity: 0.85; }

    /* ── ADVANCED FEATURES GRID ── */
    .adv-features {
      padding: 96px 40px;
      background: var(--surface-alt);
      border-top: 1px solid var(--border-light);
      border-bottom: 1px solid var(--border-light);
    }

    .adv-features-header {
      text-align: center;
      max-width: 620px;
      margin: 0 auto 56px;
    }

    .adv-features-header .section-sub { margin: 0 auto; }

    .adv-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      max-width: 1120px;
      margin: 0 auto;
    }

    .adv-card {
      background: #fff;
      border: 1px solid #000;
      border-radius: var(--radius-card);
      box-shadow: 3px 3px 0 0 #000;
      padding: 28px;
      transition: box-shadow 0.2s, transform 0.2s;
    }

    .adv-card:hover {
      box-shadow: 5px 5px 0 0 #000;
      transform: translate(-1px,-1px);
    }

    .adv-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .adv-icon svg {
      width: 22px;
      height: 22px;
      stroke: #000;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .adv-card h3 {
      font-size: 0.97rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 7px;
    }

    .adv-card p {
      font-size: 0.87rem;
      color: var(--text-muted);
      line-height: 1.65;
    }

    .adv-badge {
      display: inline-block;
      margin-top: 12px;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 3px 10px;
    }

    /* ── SUB-FEATURES 2x2 GRID ── */
    .sub-features {
      padding: 96px 40px;
      background: var(--surface);
    }

    .sub-features-header {
      max-width: 1120px;
      margin: 0 auto 52px;
    }

    .sub-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      max-width: 1120px;
      margin: 0 auto;
    }

    .sub-card {
      border: 1px solid #000;
      border-radius: var(--radius-card);
      box-shadow: 3px 3px 0 0 #000;
      padding: 32px;
      background: #fff;
      transition: box-shadow 0.2s, transform 0.2s;
    }

    .sub-card:hover {
      box-shadow: 5px 5px 0 0 #000;
      transform: translate(-1px,-1px);
    }

    .sub-card-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 18px;
    }

    .sub-card-icon svg {
      width: 22px;
      height: 22px;
      stroke: #000;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sub-card h3 {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 14px;
    }

    .sub-card ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .sub-card ul li {
      font-size: 0.88rem;
      color: var(--text-mid);
      display: flex;
      gap: 9px;
      align-items: flex-start;
      line-height: 1.5;
    }

    .sub-bullet-check {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--accent);
    }

    .sub-bullet-check svg {
      width: 16px;
      height: 16px;
      stroke: var(--accent);
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sub-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 18px;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
      border-bottom: 1px solid #000;
      padding-bottom: 1px;
      transition: color 0.2s;
    }

    .sub-link:hover { color: var(--accent); border-color: var(--accent); }

    /* ── TABS SHOWCASE ── */
    .tabs-section {
      padding: 96px 40px;
      background: var(--surface-alt);
      border-top: 1px solid var(--border-light);
      border-bottom: 1px solid var(--border-light);
    }

    .tabs-section-header {
      text-align: center;
      max-width: 700px;
      margin: 0 auto 48px;
    }

    .tabs-section-header .section-sub { margin: 0 auto; }

    .tabs-nav {
      display: flex;
      gap: 0;
      justify-content: center;
      flex-wrap: wrap;
      border: 1px solid #000;
      max-width: fit-content;
      margin: 0 auto 44px;
    }

    .tab-btn {
      padding: 10px 22px;
      border: none;
      border-right: 1px solid #000;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-muted);
      background: #fff;
      font-family: var(--font);
      transition: background 0.2s, color 0.2s;
    }

    .tab-btn:last-child { border-right: none; }

    .tab-btn.active {
      background: #000;
      color: #fff;
    }

    .tab-content { max-width: 1040px; margin: 0 auto; }

    .tab-panel { display: none; }

    .tab-panel.active {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 56px;
      align-items: center;
    }

    /* Tab visual: light document card */
    .tab-visual {
      background: #fff;
      border: 1px solid #000;
      border-radius: var(--radius-card);
      box-shadow: 3px 3px 0 0 #000;
      padding: 28px;
    }

    .tv-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .tv-title {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .tv-status {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 0;
      border: 1px solid;
    }

    .tv-status.paid {
      background: #f0fdf4;
      color: #16a34a;
      border-color: #16a34a;
    }

    .tv-status.sent {
      background: #eff6ff;
      color: #2563eb;
      border-color: #2563eb;
    }

    .tv-status.pending {
      background: #fffbeb;
      color: #d97706;
      border-color: #d97706;
    }

    .tv-amount {
      font-size: 2.2rem;
      font-weight: 900;
      color: var(--text);
      letter-spacing: -0.04em;
      margin-bottom: 4px;
    }

    .tv-meta {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .tv-rows { display: flex; flex-direction: column; gap: 7px; }

    .tv-row {
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 6px;
      height: 34px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 10px;
    }

    .tv-row-line {
      height: 5px;
      border-radius: 3px;
      background: #e5e5e5;
      flex: 1;
    }

    .tv-row-val {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .tab-info h3 {
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }

    .tab-info p {
      font-size: 0.97rem;
      color: var(--text-mid);
      line-height: 1.75;
      margin-bottom: 22px;
    }

    .tab-pills { display: flex; gap: 8px; flex-wrap: wrap; }

    .tab-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f5f5f5;
      border: 1px solid #000;
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 5px 12px;
    }

    /* ── TESTIMONIAL + 3 STATS (black bg) ── */
    .testimonial-section {
      background: #000;
      padding: 96px 40px;
    }

    .testimonial-inner {
      max-width: 1120px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 80px;
      align-items: center;
    }

    .t-quote {
      font-size: 1.45rem;
      font-weight: 700;
      color: #fff;
      line-height: 1.5;
      letter-spacing: -0.01em;
      margin-bottom: 32px;
      position: relative;
      padding-left: 24px;
    }

    .t-quote::before {
      content: '"';
      position: absolute;
      left: 0;
      top: -10px;
      font-size: 3.5rem;
      color: var(--accent);
      line-height: 1;
      opacity: 0.7;
    }

    .t-author { display: flex; align-items: center; gap: 14px; }

    .t-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: #fff;
      font-size: 1rem;
      flex-shrink: 0;
      border: 2px solid rgba(255,255,255,0.2);
    }

    .t-name { font-weight: 700; color: #fff; font-size: 0.95rem; }
    .t-role { color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-top: 2px; }

    .t-stats { display: flex; flex-direction: column; gap: 28px; }

    .t-stat {
      border-left: 2px solid var(--accent);
      padding-left: 22px;
    }

    .t-stat-value {
      font-size: 2.5rem;
      font-weight: 900;
      color: #fff;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    .t-stat-value span { color: var(--accent); }
    .t-stat-label { color: rgba(255,255,255,0.5); font-size: 0.88rem; margin-top: 6px; }

    /* ── RELATED MODULES ── */
    .related {
      padding: 96px 40px;
      background: var(--surface);
    }

    .related-header {
      max-width: 1120px;
      margin: 0 auto 48px;
    }

    .related-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      max-width: 1120px;
      margin: 0 auto;
    }

    .related-card {
      border: 1px solid #000;
      border-radius: var(--radius-card);
      box-shadow: 3px 3px 0 0 #000;
      padding: 28px;
      background: #fff;
      transition: box-shadow 0.2s, transform 0.2s;
    }

    .related-card:hover {
      box-shadow: 5px 5px 0 0 #000;
      transform: translate(-1px,-1px);
    }

    .related-visual {
      background: #f5f5f5;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      height: 100px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 14px;
      overflow: hidden;
    }

    .rv-bar {
      height: 7px;
      border-radius: 4px;
      background: #e5e5e5;
    }

    .rv-bar.accent {
      background: var(--accent);
      opacity: 0.25;
      width: 60%;
    }

    .rv-mini-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      flex: 1;
    }

    .rv-mini {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 5px;
    }

    .related-card h3 {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 8px;
    }

    .related-card p {
      font-size: 0.88rem;
      color: var(--text-muted);
      line-height: 1.65;
      margin-bottom: 18px;
    }

    .related-link {
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-bottom: 1px solid #000;
      padding-bottom: 1px;
      transition: color 0.2s;
    }

    .related-link:hover { color: var(--accent); border-color: var(--accent); }

    /* ── FAQ ── */
    .faq {
      padding: 96px 40px;
      background: var(--surface-alt);
      border-top: 1px solid var(--border-light);
    }

    .faq-inner { max-width: 760px; margin: 0 auto; }

    .faq-header { margin-bottom: 44px; }

    .faq-item { border-bottom: 1px solid #000; }

    .faq-q {
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      cursor: pointer;
      padding: 20px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      font-family: var(--font);
      transition: color 0.2s;
    }

    .faq-q:hover { color: var(--accent); }

    .faq-chevron {
      font-size: 1.1rem;
      color: var(--text-muted);
      transition: transform 0.3s;
      flex-shrink: 0;
      font-style: normal;
    }

    .faq-a {
      overflow: hidden;
      max-height: 0;
      transition: max-height 0.35s ease;
    }

    .faq-a p {
      padding-bottom: 22px;
      font-size: 0.93rem;
      color: var(--text-mid);
      line-height: 1.8;
    }

    .faq-item.open .faq-chevron { transform: rotate(180deg); }
    .faq-item.open .faq-a { max-height: 400px; }
    .faq-item:first-of-type { border-top: 1px solid #000; }

    /* ── FINAL CTA BANNER ── */
    .cta-banner {
      background: #000;
      padding: 100px 40px;
      text-align: center;
    }

    .cta-inner { max-width: 640px; margin: 0 auto; }

    .cta-banner h2 {
      font-size: clamp(1.8rem, 3.5vw, 2.7rem);
      font-weight: 900;
      color: #fff;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 16px;
    }

    .cta-banner p {
      font-size: 1.05rem;
      color: rgba(255,255,255,0.6);
      margin-bottom: 38px;
      line-height: 1.7;
    }

    .cta-banner-btns {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
    }

    .btn-cta-white {
      background: #fff;
      color: #000;
      padding: 14px 30px;
      border-radius: var(--radius-btn);
      font-size: 0.97rem;
      font-weight: 700;
      text-decoration: none;
      border: 1px solid #fff;
      font-family: var(--font);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: opacity 0.2s;
    }

    .btn-cta-white:hover { opacity: 0.9; }

    .btn-cta-outline-white {
      background: transparent;
      color: #fff;
      padding: 14px 30px;
      border-radius: var(--radius-btn);
      font-size: 0.97rem;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid rgba(255,255,255,0.4);
      font-family: var(--font);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: border-color 0.2s;
    }

    .btn-cta-outline-white:hover { border-color: rgba(255,255,255,0.8); }

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

    .footer-socials { display: flex; gap: 10px; }

    .footer-social-btn {
      width: 36px;
      height: 36px;
      background: #f5f5f5;
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
      font-size: 0.78rem;
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

    .footer-bottom p { font-size: 0.82rem; color: #737373; }

    .footer-bottom-links { display: flex; gap: 20px; }

    .footer-bottom-links a {
      text-decoration: none;
      color: #737373;
      font-size: 0.82rem;
      transition: color 0.2s;
    }

    .footer-bottom-links a:hover { color: #fbbf24; }

    /* ── RESPONSIVE ── */
    @media (max-width: 1024px) {
      .adv-grid { grid-template-columns: repeat(2, 1fr); }
      .footer-grid { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 768px) {
      nav { padding: 0 20px; }
      .nav-links, .nav-actions { display: none; }
      .hamburger { display: flex; }

      .hero { padding-left: 20px; padding-right: 20px; }
      .hero h1 { font-size: 2.1rem; }
      .hero-sub { font-size: 1rem; }
      .hero-ctas { flex-direction: column; align-items: stretch; }
      .btn-primary, .btn-secondary { justify-content: center; }
      .hero-mockup { display: none; }

      .logos { padding: 36px 20px; }

      .features-section { padding: 64px 20px; }
      .feature-block { grid-template-columns: 1fr; gap: 36px; margin-bottom: 64px; }
      .feature-block.flip { direction: ltr; }
      .feature-visual { aspect-ratio: 3/2; }

      .adv-features { padding: 64px 20px; }
      .adv-grid { grid-template-columns: 1fr; }

      .sub-features { padding: 64px 20px; }
      .sub-grid { grid-template-columns: 1fr; }

      .tabs-section { padding: 64px 20px; }
      .tab-panel.active { grid-template-columns: 1fr; }
      .tab-visual { display: none; }
      .tabs-nav { max-width: 100%; flex-wrap: wrap; }
      .tab-btn { border-bottom: 1px solid #000; }

      .testimonial-section { padding: 64px 20px; }
      .testimonial-inner { grid-template-columns: 1fr; gap: 48px; }

      .related { padding: 64px 20px; }
      .related-grid { grid-template-columns: 1fr; }

      .faq { padding: 64px 20px; }

      .cta-banner { padding: 72px 20px; }
      .cta-banner-btns { flex-direction: column; align-items: center; }
      .btn-cta-white, .btn-cta-outline-white { justify-content: center; width: 100%; max-width: 320px; }

      footer { padding: 48px 20px 0; }
      .footer-grid { grid-template-columns: 1fr; gap: 36px; }
      .footer-bottom { flex-direction: column; align-items: flex-start; }
      .footer-bottom-links { flex-wrap: wrap; gap: 14px; }
    }

    @media (max-width: 480px) {
      .social-proof { flex-direction: column; gap: 8px; }
      .mockup-cards { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<!-- ── NAVBAR ── -->
<nav>
  <a href="{{home_url}}" class="nav-logo" aria-label="{{company_name}}">
    <div class="nav-logo-mark">{{company_name_initial}}</div>
    <span class="nav-logo-text">{{company_name}}</span>
  </a>

  <ul class="nav-links">
    <li><a href="{{nav_link_1_url}}">{{nav_link_1}}</a></li>
    <li><a href="{{nav_link_2_url}}">{{nav_link_2}}</a></li>
    <li><a href="{{nav_link_3_url}}" class="active">{{nav_link_3}}</a></li>
    <li><a href="{{nav_link_4_url}}">{{nav_link_4}}</a></li>
  </ul>

  <div class="nav-actions">
    <a href="{{login_url}}" class="btn-ghost-nav">{{nav_login}}</a>
    <a href="{{signup_url}}" class="btn-accent-nav">{{nav_cta}}</a>
  </div>

  <button class="hamburger" id="hamburgerBtn" aria-label="Menu" aria-expanded="false">
    <span></span>
    <span></span>
    <span></span>
  </button>
</nav>

<!-- ── MOBILE MENU ── -->
<div class="mobile-menu" id="mobileMenu" role="navigation">
  <a href="{{nav_link_1_url}}">{{nav_link_1}}</a>
  <a href="{{nav_link_2_url}}">{{nav_link_2}}</a>
  <a href="{{nav_link_3_url}}">{{nav_link_3}}</a>
  <a href="{{nav_link_4_url}}">{{nav_link_4}}</a>
  <a href="{{login_url}}" class="btn-ghost-nav" style="text-align:center;margin-top:8px;">{{nav_login}}</a>
  <a href="{{signup_url}}" class="btn-accent-nav">{{nav_cta}}</a>
</div>

<!-- ── HERO ── -->
<section class="hero" id="home">
  <div class="hero-grid-bg" aria-hidden="true"></div>
  <div class="hero-inner">
    <div class="badge">
      <span class="badge-dot"></span>
      {{hero_badge}}
    </div>
    <h1>{{hero_title}} <span class="highlight">{{hero_title_accent}}</span></h1>
    <p class="hero-sub">{{hero_subtitle}}</p>
    <div class="hero-ctas">
      <a href="{{signup_url}}" class="btn-primary">
        {{hero_cta_primary}}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
      <a href="{{demo_url}}" class="btn-secondary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>
        {{hero_cta_secondary}}
      </a>
    </div>
    <div class="social-proof">
      <span class="social-proof-item"><span class="social-proof-check">✓</span> {{hero_social_proof_1}}</span>
      <span class="social-proof-item"><span class="social-proof-check">✓</span> {{hero_social_proof_2}}</span>
      <span class="social-proof-item"><span class="social-proof-check">✓</span> {{hero_social_proof_3}}</span>
    </div>
  </div>

  <!-- Browser mockup -->
  <div class="hero-mockup" aria-hidden="true">
    <div class="mockup-bar">
      <div class="mockup-dots">
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
      </div>
      <div class="mockup-url">{{mockup_url}}</div>
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

<!-- ── TRUST LOGOS ── -->
<div class="logos" aria-label="{{logos_label}}">
  <p class="logos-label">{{logos_label}}</p>
  <div class="logos-grid">
    <div class="logo-item">{{logo_1}}</div>
    <div class="logo-item">{{logo_2}}</div>
    <div class="logo-item">{{logo_3}}</div>
    <div class="logo-item">{{logo_4}}</div>
    <div class="logo-item">{{logo_5}}</div>
  </div>
</div>

<!-- ── FEATURE DEEP-DIVE BLOCKS ── -->
<section class="features-section" id="features">

  <!-- Feature Block 1 -->
  <div class="feature-block">
    <div class="feature-visual" aria-hidden="true">
      <div class="feature-visual-inner">
        <div class="fv-row">
          <div class="fv-pill accent"></div>
          <div class="fv-pill"></div>
          <div class="fv-pill"></div>
        </div>
        <div class="fv-row" style="flex:1">
          <div class="fv-block"></div>
          <div class="fv-block accent"></div>
        </div>
        <div class="fv-row"><div class="fv-line"></div></div>
        <div class="fv-row"><div class="fv-line short"></div></div>
      </div>
    </div>
    <div>
      <span class="section-label">{{feat1_label}}</span>
      <h2 class="section-title">{{feat1_title}}</h2>
      <p class="section-sub">{{feat1_desc}}</p>
      <ul class="feature-points">
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat1_point1_title}}</div>
            <div class="fp-desc">{{feat1_point1_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat1_point2_title}}</div>
            <div class="fp-desc">{{feat1_point2_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat1_point3_title}}</div>
            <div class="fp-desc">{{feat1_point3_desc}}</div>
          </div>
        </li>
      </ul>
      <div style="margin-top:30px">
        <a href="{{signup_url}}" class="btn-cta">{{feat1_cta}}</a>
      </div>
    </div>
  </div>

  <!-- Feature Block 2 (flipped) -->
  <div class="feature-block flip">
    <div class="feature-visual" aria-hidden="true">
      <div class="feature-visual-inner">
        <div class="fv-grid">
          <div class="fv-mini">
            <div class="fv-mini-line"></div>
            <div class="fv-mini-val accent">{{feat2_kpi1}}</div>
          </div>
          <div class="fv-mini">
            <div class="fv-mini-line"></div>
            <div class="fv-mini-val">{{feat2_kpi2}}</div>
          </div>
          <div class="fv-mini">
            <div class="fv-mini-line"></div>
            <div class="fv-mini-val">{{feat2_kpi3}}</div>
          </div>
          <div class="fv-mini">
            <div class="fv-mini-line"></div>
            <div class="fv-mini-val accent">{{feat2_kpi4}}</div>
          </div>
        </div>
        <div class="fv-row"><div class="fv-line"></div></div>
        <div class="fv-row">
          <div class="fv-pill"></div>
          <div class="fv-pill accent"></div>
        </div>
      </div>
    </div>
    <div>
      <span class="section-label">{{feat2_label}}</span>
      <h2 class="section-title">{{feat2_title}}</h2>
      <p class="section-sub">{{feat2_desc}}</p>
      <ul class="feature-points">
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat2_point1_title}}</div>
            <div class="fp-desc">{{feat2_point1_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat2_point2_title}}</div>
            <div class="fp-desc">{{feat2_point2_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat2_point3_title}}</div>
            <div class="fp-desc">{{feat2_point3_desc}}</div>
          </div>
        </li>
      </ul>
      <div style="margin-top:30px">
        <a href="{{signup_url}}" class="btn-cta">{{feat2_cta}}</a>
      </div>
    </div>
  </div>

  <!-- Feature Block 3 -->
  <div class="feature-block">
    <div class="feature-visual" aria-hidden="true">
      <div class="feature-visual-inner">
        <div class="fv-row">
          <div class="fv-pill"></div>
          <div class="fv-pill"></div>
          <div class="fv-pill accent"></div>
        </div>
        <div class="fv-row" style="flex:1">
          <div class="fv-block"></div>
        </div>
        <div class="fv-row"><div class="fv-line short"></div></div>
        <div class="fv-row"><div class="fv-line"></div></div>
      </div>
    </div>
    <div>
      <span class="section-label">{{feat3_label}}</span>
      <h2 class="section-title">{{feat3_title}}</h2>
      <p class="section-sub">{{feat3_desc}}</p>
      <ul class="feature-points">
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat3_point1_title}}</div>
            <div class="fp-desc">{{feat3_point1_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat3_point2_title}}</div>
            <div class="fp-desc">{{feat3_point2_desc}}</div>
          </div>
        </li>
        <li>
          <div class="fp-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div>
            <div class="fp-title">{{feat3_point3_title}}</div>
            <div class="fp-desc">{{feat3_point3_desc}}</div>
          </div>
        </li>
      </ul>
      <div style="margin-top:30px">
        <a href="{{signup_url}}" class="btn-cta">{{feat3_cta}}</a>
      </div>
    </div>
  </div>

</section>

<!-- ── ADVANCED FEATURES GRID ── -->
<section class="adv-features">
  <div class="adv-features-header">
    <span class="section-label">{{adv_section_label}}</span>
    <h2 class="section-title">{{adv_section_title}}</h2>
    <p class="section-sub">{{adv_section_desc}}</p>
  </div>
  <div class="adv-grid">
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </div>
      <h3>{{adv1_title}}</h3>
      <p>{{adv1_desc}}</p>
    </div>
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <h3>{{adv2_title}}</h3>
      <p>{{adv2_desc}}</p>
    </div>
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <h3>{{adv3_title}}</h3>
      <p>{{adv3_desc}}</p>
      <span class="adv-badge">{{adv3_badge}}</span>
    </div>
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
      </div>
      <h3>{{adv4_title}}</h3>
      <p>{{adv4_desc}}</p>
    </div>
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <h3>{{adv5_title}}</h3>
      <p>{{adv5_desc}}</p>
    </div>
    <div class="adv-card">
      <div class="adv-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <h3>{{adv6_title}}</h3>
      <p>{{adv6_desc}}</p>
    </div>
  </div>
</section>

<!-- ── SUB-FEATURES 2x2 GRID ── -->
<section class="sub-features">
  <div class="sub-features-header">
    <span class="section-label">{{sub_section_label}}</span>
    <h2 class="section-title">{{sub_section_title}}</h2>
  </div>
  <div class="sub-grid">
    <div class="sub-card">
      <div class="sub-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <h3>{{sub1_title}}</h3>
      <ul>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub1_bullet1}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub1_bullet2}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub1_bullet3}}
        </li>
      </ul>
      <a href="{{sub1_url}}" class="sub-link">{{sub1_link}} →</a>
    </div>
    <div class="sub-card">
      <div class="sub-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      </div>
      <h3>{{sub2_title}}</h3>
      <ul>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub2_bullet1}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub2_bullet2}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub2_bullet3}}
        </li>
      </ul>
      <a href="{{sub2_url}}" class="sub-link">{{sub2_link}} →</a>
    </div>
    <div class="sub-card">
      <div class="sub-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3>{{sub3_title}}</h3>
      <ul>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub3_bullet1}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub3_bullet2}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub3_bullet3}}
        </li>
      </ul>
      <a href="{{sub3_url}}" class="sub-link">{{sub3_link}} →</a>
    </div>
    <div class="sub-card">
      <div class="sub-card-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      </div>
      <h3>{{sub4_title}}</h3>
      <ul>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub4_bullet1}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub4_bullet2}}
        </li>
        <li>
          <span class="sub-bullet-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
          {{sub4_bullet3}}
        </li>
      </ul>
      <a href="{{sub4_url}}" class="sub-link">{{sub4_link}} →</a>
    </div>
  </div>
</section>

<!-- ── TABS SHOWCASE ── -->
<section class="tabs-section">
  <div class="tabs-section-header">
    <span class="section-label">{{tabs_section_label}}</span>
    <h2 class="section-title">{{tabs_section_title}}</h2>
    <p class="section-sub">{{tabs_section_desc}}</p>
  </div>
  <div class="tabs-nav" role="tablist">
    <button class="tab-btn active" role="tab" aria-selected="true" aria-controls="tab1" onclick="switchTab(this,'tab1')">{{tab1_name}}</button>
    <button class="tab-btn" role="tab" aria-selected="false" aria-controls="tab2" onclick="switchTab(this,'tab2')">{{tab2_name}}</button>
    <button class="tab-btn" role="tab" aria-selected="false" aria-controls="tab3" onclick="switchTab(this,'tab3')">{{tab3_name}}</button>
    <button class="tab-btn" role="tab" aria-selected="false" aria-controls="tab4" onclick="switchTab(this,'tab4')">{{tab4_name}}</button>
  </div>
  <div class="tab-content">

    <div id="tab1" class="tab-panel active" role="tabpanel">
      <div class="tab-visual" aria-hidden="true">
        <div class="tv-header">
          <div class="tv-title">{{tab1_doc_type}}</div>
          <div class="tv-status paid">{{tab1_status}}</div>
        </div>
        <div class="tv-amount">{{tab1_amount}}</div>
        <div class="tv-meta">{{tab1_meta}}</div>
        <div class="tv-rows">
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab1_val1}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab1_val2}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab1_val3}}</div></div>
        </div>
      </div>
      <div class="tab-info">
        <h3>{{tab1_title}}</h3>
        <p>{{tab1_desc}}</p>
        <div class="tab-pills">
          <span class="tab-pill">✓ {{tab1_pill1}}</span>
          <span class="tab-pill">✓ {{tab1_pill2}}</span>
          <span class="tab-pill">✓ {{tab1_pill3}}</span>
        </div>
      </div>
    </div>

    <div id="tab2" class="tab-panel" role="tabpanel">
      <div class="tab-visual" aria-hidden="true">
        <div class="tv-header">
          <div class="tv-title">{{tab2_doc_type}}</div>
          <div class="tv-status sent">{{tab2_status}}</div>
        </div>
        <div class="tv-amount">{{tab2_amount}}</div>
        <div class="tv-meta">{{tab2_meta}}</div>
        <div class="tv-rows">
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab2_val1}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab2_val2}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab2_val3}}</div></div>
        </div>
      </div>
      <div class="tab-info">
        <h3>{{tab2_title}}</h3>
        <p>{{tab2_desc}}</p>
        <div class="tab-pills">
          <span class="tab-pill">✓ {{tab2_pill1}}</span>
          <span class="tab-pill">✓ {{tab2_pill2}}</span>
          <span class="tab-pill">✓ {{tab2_pill3}}</span>
        </div>
      </div>
    </div>

    <div id="tab3" class="tab-panel" role="tabpanel">
      <div class="tab-visual" aria-hidden="true">
        <div class="tv-header">
          <div class="tv-title">{{tab3_doc_type}}</div>
          <div class="tv-status pending">{{tab3_status}}</div>
        </div>
        <div class="tv-amount">{{tab3_amount}}</div>
        <div class="tv-meta">{{tab3_meta}}</div>
        <div class="tv-rows">
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab3_val1}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab3_val2}}</div></div>
        </div>
      </div>
      <div class="tab-info">
        <h3>{{tab3_title}}</h3>
        <p>{{tab3_desc}}</p>
        <div class="tab-pills">
          <span class="tab-pill">✓ {{tab3_pill1}}</span>
          <span class="tab-pill">✓ {{tab3_pill2}}</span>
          <span class="tab-pill">✓ {{tab3_pill3}}</span>
        </div>
      </div>
    </div>

    <div id="tab4" class="tab-panel" role="tabpanel">
      <div class="tab-visual" aria-hidden="true">
        <div class="tv-header">
          <div class="tv-title">{{tab4_doc_type}}</div>
          <div class="tv-status paid">{{tab4_status}}</div>
        </div>
        <div class="tv-amount">{{tab4_amount}}</div>
        <div class="tv-meta">{{tab4_meta}}</div>
        <div class="tv-rows">
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab4_val1}}</div></div>
          <div class="tv-row"><div class="tv-row-line"></div><div class="tv-row-val">{{tab4_val2}}</div></div>
        </div>
      </div>
      <div class="tab-info">
        <h3>{{tab4_title}}</h3>
        <p>{{tab4_desc}}</p>
        <div class="tab-pills">
          <span class="tab-pill">✓ {{tab4_pill1}}</span>
          <span class="tab-pill">✓ {{tab4_pill2}}</span>
          <span class="tab-pill">✓ {{tab4_pill3}}</span>
        </div>
      </div>
    </div>

  </div>
</section>

<!-- ── TESTIMONIAL + 3 STATS (black bg) ── -->
<section class="testimonial-section">
  <div class="testimonial-inner">
    <div>
      <p class="t-quote">{{testimonial_quote}}</p>
      <div class="t-author">
        <div class="t-avatar" aria-hidden="true">{{testimonial_initials}}</div>
        <div>
          <div class="t-name">{{testimonial_name}}</div>
          <div class="t-role">{{testimonial_role}}</div>
        </div>
      </div>
    </div>
    <div class="t-stats">
      <div class="t-stat">
        <div class="t-stat-value">{{stat1_value}}<span>{{stat1_suffix}}</span></div>
        <div class="t-stat-label">{{stat1_label}}</div>
      </div>
      <div class="t-stat">
        <div class="t-stat-value">{{stat2_value}}<span>{{stat2_suffix}}</span></div>
        <div class="t-stat-label">{{stat2_label}}</div>
      </div>
      <div class="t-stat">
        <div class="t-stat-value">{{stat3_value}}<span>{{stat3_suffix}}</span></div>
        <div class="t-stat-label">{{stat3_label}}</div>
      </div>
    </div>
  </div>
</section>

<!-- ── RELATED MODULES ── -->
<section class="related">
  <div class="related-header">
    <span class="section-label">{{related_label}}</span>
    <h2 class="section-title">{{related_title}}</h2>
  </div>
  <div class="related-grid">
    <div class="related-card">
      <div class="related-visual" aria-hidden="true">
        <div class="rv-bar accent"></div>
        <div class="rv-mini-grid">
          <div class="rv-mini"></div>
          <div class="rv-mini"></div>
        </div>
      </div>
      <h3>{{related1_title}}</h3>
      <p>{{related1_desc}}</p>
      <a href="{{related1_url}}" class="related-link">{{related1_cta}} →</a>
    </div>
    <div class="related-card">
      <div class="related-visual" aria-hidden="true">
        <div class="rv-bar"></div>
        <div class="rv-bar accent"></div>
        <div class="rv-mini-grid">
          <div class="rv-mini"></div>
          <div class="rv-mini"></div>
        </div>
      </div>
      <h3>{{related2_title}}</h3>
      <p>{{related2_desc}}</p>
      <a href="{{related2_url}}" class="related-link">{{related2_cta}} →</a>
    </div>
    <div class="related-card">
      <div class="related-visual" aria-hidden="true">
        <div class="rv-mini-grid" style="height:100%">
          <div class="rv-mini"></div>
          <div class="rv-mini"></div>
          <div class="rv-mini"></div>
          <div class="rv-mini"></div>
        </div>
      </div>
      <h3>{{related3_title}}</h3>
      <p>{{related3_desc}}</p>
      <a href="{{related3_url}}" class="related-link">{{related3_cta}} →</a>
    </div>
  </div>
</section>

<!-- ── FAQ ACCORDION ── -->
<section class="faq" id="faq">
  <div class="faq-inner">
    <div class="faq-header">
      <span class="section-label">{{faq_label}}</span>
      <h2 class="section-title">{{faq_title}}</h2>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)" aria-expanded="false">
        {{faq1_q}}<span class="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="faq-a"><p>{{faq1_a}}</p></div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)" aria-expanded="false">
        {{faq2_q}}<span class="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="faq-a"><p>{{faq2_a}}</p></div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)" aria-expanded="false">
        {{faq3_q}}<span class="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="faq-a"><p>{{faq3_a}}</p></div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)" aria-expanded="false">
        {{faq4_q}}<span class="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="faq-a"><p>{{faq4_a}}</p></div>
    </div>
    <div class="faq-item">
      <button class="faq-q" onclick="toggleFaq(this)" aria-expanded="false">
        {{faq5_q}}<span class="faq-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="faq-a"><p>{{faq5_a}}</p></div>
    </div>
  </div>
</section>

<!-- ── FINAL CTA BANNER ── -->
<section class="cta-banner">
  <div class="cta-inner">
    <h2>{{cta_title}}</h2>
    <p>{{cta_subtitle}}</p>
    <div class="cta-banner-btns">
      <a href="{{signup_url}}" class="btn-cta-white">
        {{cta_primary}}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </a>
      <a href="{{demo_url}}" class="btn-cta-outline-white">{{cta_secondary}}</a>
    </div>
  </div>
</section>

<!-- ── FOOTER ── -->
<footer>
  <div class="footer-grid">
    <!-- Col 1: Brand -->
    <div>
      <a href="{{home_url}}" class="footer-logo" aria-label="{{company_name}}">
        <div class="footer-logo-mark">{{company_name_initial}}</div>
        <span class="footer-logo-text">{{company_name}}</span>
      </a>
      <p class="footer-desc">{{footer_desc}}</p>
      <div class="footer-socials">
        <!-- Twitter/X -->
        <a href="{{social_twitter_url}}" class="footer-social-btn" aria-label="Twitter">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <!-- LinkedIn -->
        <a href="{{social_linkedin_url}}" class="footer-social-btn" aria-label="LinkedIn">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
        <!-- GitHub -->
        <a href="{{social_github_url}}" class="footer-social-btn" aria-label="GitHub">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
        </a>
      </div>
    </div>

    <!-- Col 2 -->
    <div class="footer-col">
      <h5>{{footer_col1_title}}</h5>
      <ul class="footer-links">
        <li><a href="{{footer_col1_url1}}">{{footer_col1_link1}}</a></li>
        <li><a href="{{footer_col1_url2}}">{{footer_col1_link2}}</a></li>
        <li><a href="{{footer_col1_url3}}">{{footer_col1_link3}}</a></li>
        <li><a href="{{footer_col1_url4}}">{{footer_col1_link4}}</a></li>
      </ul>
    </div>

    <!-- Col 3 -->
    <div class="footer-col">
      <h5>{{footer_col2_title}}</h5>
      <ul class="footer-links">
        <li><a href="{{footer_col2_url1}}">{{footer_col2_link1}}</a></li>
        <li><a href="{{footer_col2_url2}}">{{footer_col2_link2}}</a></li>
        <li><a href="{{footer_col2_url3}}">{{footer_col2_link3}}</a></li>
        <li><a href="{{footer_col2_url4}}">{{footer_col2_link4}}</a></li>
      </ul>
    </div>

    <!-- Col 4 -->
    <div class="footer-col">
      <h5>{{footer_col3_title}}</h5>
      <ul class="footer-links">
        <li><a href="{{footer_col3_url1}}">{{footer_col3_link1}}</a></li>
        <li><a href="{{footer_col3_url2}}">{{footer_col3_link2}}</a></li>
        <li><a href="{{footer_col3_url3}}">{{footer_col3_link3}}</a></li>
        <li><a href="{{footer_col3_url4}}">{{footer_col3_link4}}</a></li>
      </ul>
    </div>
  </div>

  <div class="footer-bottom">
    <p>{{footer_copyright}}</p>
    <div class="footer-bottom-links">
      <a href="{{footer_privacy_url}}">{{footer_privacy_link}}</a>
      <a href="{{footer_terms_url}}">{{footer_terms_link}}</a>
      <a href="{{footer_cookie_url}}">{{footer_cookie_link}}</a>
    </div>
  </div>
</footer>

<script>
  // ── Tab switcher ──
  function switchTab(btn, tabId) {
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function(p) {
      p.classList.remove('active');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    var panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');
  }

  // ── FAQ accordion ──
  function toggleFaq(btn) {
    var item = btn.parentElement;
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(i) {
      i.classList.remove('open');
      var q = i.querySelector('.faq-q');
      if (q) q.setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      item.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  // ── Hamburger / mobile menu ──
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
