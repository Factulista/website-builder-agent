export const SAAS_FEATURE_TEMPLATE = `<!DOCTYPE html>
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --dark: #0f1523;
      --dark2: #1a2235;
      --accent: {{primary_color}};
      --text: #ffffff;
      --text-muted: #94a3b8;
      --light-bg: #f8fafc;
      --light-text: #1e293b;
      --light-muted: #64748b;
      --border: rgba(255,255,255,0.08);
      --border-light: #e2e8f0;
      --radius: 12px;
      --font: 'Inter', sans-serif;
    }

    body { font-family: var(--font); background: #fff; color: var(--light-text); line-height: 1.6; }

    /* ── NAVBAR ── */
    nav {
      position: sticky; top: 0; z-index: 100;
      background: var(--dark);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 5%;
      height: 64px;
    }
    .nav-logo {
      font-size: 1.4rem; font-weight: 800; color: #fff;
      text-decoration: none; letter-spacing: -0.5px;
    }
    .nav-logo span { color: var(--accent); }
    .nav-links { display: flex; gap: 32px; list-style: none; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: color 0.2s; }
    .nav-links a:hover { color: #fff; }
    .nav-links a.active { color: #fff; }
    .nav-ctas { display: flex; gap: 12px; align-items: center; }
    .btn-ghost { background: transparent; color: #fff; border: 1px solid var(--border); padding: 8px 18px; border-radius: 8px; font-size: 0.88rem; font-weight: 500; cursor: pointer; text-decoration: none; transition: border-color 0.2s; }
    .btn-ghost:hover { border-color: rgba(255,255,255,0.3); }
    .btn-primary { background: var(--accent); color: #fff; border: none; padding: 8px 20px; border-radius: 8px; font-size: 0.88rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity 0.2s; }
    .btn-primary:hover { opacity: 0.9; }

    /* ── HERO FEATURE ── */
    .hero {
      background: var(--dark);
      padding: 80px 5% 0;
      overflow: hidden;
    }
    .hero-inner {
      max-width: 1200px; margin: 0 auto;
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 60px; align-items: center;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(255,255,255,0.07);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.78rem; font-weight: 600;
      letter-spacing: 0.8px; text-transform: uppercase;
      padding: 6px 14px; border-radius: 100px;
      margin-bottom: 24px;
    }
    .hero-badge-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); flex-shrink: 0;
    }
    .hero-content h1 {
      font-size: clamp(2.2rem, 4vw, 3.4rem);
      font-weight: 900; color: #fff;
      line-height: 1.1; letter-spacing: -1.5px;
      margin-bottom: 20px;
    }
    .hero-content h1 em { color: var(--accent); font-style: normal; }
    .hero-content p {
      font-size: 1.1rem; color: var(--text-muted);
      line-height: 1.75; margin-bottom: 36px; max-width: 480px;
    }
    .hero-ctas { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 32px; }
    .btn-hero {
      background: #fff; color: var(--dark);
      padding: 13px 26px; border-radius: 10px;
      font-size: 0.95rem; font-weight: 700;
      text-decoration: none; transition: opacity 0.2s;
    }
    .btn-hero:hover { opacity: 0.9; }
    .btn-hero-outline {
      background: transparent; color: #fff;
      border: 1px solid rgba(255,255,255,0.2);
      padding: 13px 26px; border-radius: 10px;
      font-size: 0.95rem; font-weight: 600;
      text-decoration: none; transition: border-color 0.2s;
    }
    .btn-hero-outline:hover { border-color: rgba(255,255,255,0.5); }
    .hero-meta {
      display: flex; gap: 20px; align-items: center;
      font-size: 0.82rem; color: var(--text-muted);
    }
    .hero-meta-item { display: flex; align-items: center; gap: 6px; }
    .hero-meta-item svg { width: 14px; height: 14px; opacity: 0.6; }
    .hero-visual {
      position: relative;
      padding-bottom: 60px;
    }
    .hero-screen {
      background: var(--dark2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.5);
    }
    .hs-bar { display: flex; gap: 6px; margin-bottom: 14px; }
    .hs-dot { width: 9px; height: 9px; border-radius: 50%; }
    .hs-dot:nth-child(1) { background: #ef4444; }
    .hs-dot:nth-child(2) { background: #f59e0b; }
    .hs-dot:nth-child(3) { background: #22c55e; }
    .hs-body {
      background: #162032; border-radius: 10px;
      padding: 20px; display: flex; flex-direction: column; gap: 14px;
    }
    .hs-header { display: flex; justify-content: space-between; align-items: center; }
    .hs-title { height: 10px; width: 120px; border-radius: 5px; background: rgba(255,255,255,0.15); }
    .hs-pill { height: 22px; width: 70px; border-radius: 100px; background: var(--accent); opacity: 0.6; }
    .hs-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .hs-kpi {
      background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px;
    }
    .hs-kpi-label { height: 7px; width: 50px; border-radius: 4px; background: rgba(255,255,255,0.1); margin-bottom: 8px; }
    .hs-kpi-value { font-size: 1.3rem; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
    .hs-kpi-value.accent { color: var(--accent); }
    .hs-list { display: flex; flex-direction: column; gap: 7px; }
    .hs-row {
      height: 34px; border-radius: 6px;
      background: rgba(255,255,255,0.04);
      display: flex; align-items: center; padding: 0 12px; gap: 10px;
    }
    .hs-row-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); opacity: 0.5; flex-shrink: 0; }
    .hs-row-line { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); flex: 1; }
    .hs-row-tag { height: 18px; width: 48px; border-radius: 100px; background: rgba(255,255,255,0.07); }
    .hero-float {
      position: absolute; bottom: 20px; right: -20px;
      background: #fff; border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      display: flex; align-items: center; gap: 10px;
      font-size: 0.82rem;
    }
    .hf-icon { font-size: 1.4rem; }
    .hf-label { color: var(--light-muted); font-size: 0.75rem; }
    .hf-value { font-weight: 800; color: var(--light-text); font-size: 1rem; letter-spacing: -0.3px; }

    /* ── TRUST LOGOS ── */
    .logos {
      padding: 48px 5%;
      background: var(--light-bg);
      text-align: center;
    }
    .logos-label { color: var(--light-muted); font-size: 0.8rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 28px; }
    .logos-grid {
      display: flex; align-items: center; justify-content: center;
      gap: 48px; flex-wrap: wrap;
    }
    .logo-item { font-size: 1rem; font-weight: 800; color: #cbd5e1; letter-spacing: -0.3px; }

    /* ── SECTION COMMONS ── */
    .section-label {
      font-size: 0.78rem; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; color: var(--accent); margin-bottom: 10px;
    }
    .section-title {
      font-size: clamp(1.8rem, 3vw, 2.5rem);
      font-weight: 800; color: var(--light-text);
      letter-spacing: -0.8px; line-height: 1.15; margin-bottom: 14px;
    }
    .section-sub {
      color: var(--light-muted); font-size: 1rem;
      max-width: 520px; line-height: 1.75; margin-bottom: 32px;
    }
    .btn-cta {
      display: inline-block;
      background: var(--accent); color: #fff;
      padding: 12px 24px; border-radius: 9px;
      font-size: 0.92rem; font-weight: 700; text-decoration: none;
      transition: opacity 0.2s;
    }
    .btn-cta:hover { opacity: 0.85; }

    /* ── FEATURE DEEP-DIVE ── */
    .features { padding: 80px 5%; }
    .feature-block {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 80px; align-items: center;
      margin-bottom: 100px; max-width: 1200px; margin-left: auto; margin-right: auto;
    }
    .feature-block:last-child { margin-bottom: 0; }
    .feature-block.flip { direction: rtl; }
    .feature-block.flip > * { direction: ltr; }
    .feature-visual {
      background: var(--light-bg);
      border-radius: 20px;
      aspect-ratio: 4/3;
      display: flex; align-items: center; justify-content: center;
      border: 1px solid var(--border-light);
      overflow: hidden; position: relative;
    }
    .feature-visual-inner {
      width: 84%; height: 84%;
      background: var(--dark2); border-radius: 12px;
      padding: 18px; display: flex; flex-direction: column; gap: 10px;
    }
    .fv-row { display: flex; gap: 8px; align-items: center; }
    .fv-pill { height: 26px; border-radius: 100px; background: rgba(255,255,255,0.07); flex: 1; }
    .fv-pill.accent { background: var(--accent); opacity: 0.65; flex: 0 0 72px; }
    .fv-block { height: 72px; border-radius: 8px; background: rgba(255,255,255,0.05); flex: 1; }
    .fv-block.accent { background: color-mix(in srgb, var(--accent) 20%, transparent); }
    .fv-line { height: 7px; border-radius: 4px; background: rgba(255,255,255,0.08); flex: 1; }
    .fv-line.short { flex: 0 0 35%; }
    .fv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 1; }
    .fv-mini { background: rgba(255,255,255,0.05); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .fv-mini-line { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.1); }
    .fv-mini-val { font-size: 1.1rem; font-weight: 800; color: #fff; }
    .fv-mini-val.accent { color: var(--accent); }
    .feature-points { list-style: none; display: flex; flex-direction: column; gap: 18px; margin-top: 8px; }
    .feature-points li { display: flex; gap: 12px; align-items: flex-start; }
    .fp-icon {
      width: 30px; height: 30px; border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.9rem; flex-shrink: 0; margin-top: 2px;
    }
    .fp-title { font-weight: 700; color: var(--light-text); margin-bottom: 3px; font-size: 0.95rem; }
    .fp-desc { color: var(--light-muted); font-size: 0.88rem; line-height: 1.6; }

    /* ── ADVANCED FEATURES GRID ── */
    .adv-features { padding: 80px 5%; background: var(--dark); }
    .adv-features-header { text-align: center; max-width: 600px; margin: 0 auto 52px; }
    .adv-features-header .section-title { color: #fff; }
    .adv-features-header .section-sub { color: var(--text-muted); margin: 0 auto; }
    .adv-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 16px; max-width: 1100px; margin: 0 auto;
    }
    .adv-card {
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      border-radius: 14px; padding: 24px;
      transition: border-color 0.2s;
    }
    .adv-card:hover { border-color: rgba(255,255,255,0.15); }
    .adv-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; margin-bottom: 14px;
    }
    .adv-card h3 { font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .adv-card p { font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; }
    .adv-badge {
      display: inline-block; margin-top: 10px;
      background: rgba(255,255,255,0.07); color: var(--text-muted);
      font-size: 0.7rem; font-weight: 600; letter-spacing: 0.5px;
      padding: 3px 10px; border-radius: 100px;
    }

    /* ── SUB-FEATURES DETAIL GRID ── */
    .sub-features { padding: 80px 5%; }
    .sub-features-header { max-width: 1100px; margin: 0 auto 48px; }
    .sub-grid {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 20px; max-width: 1100px; margin: 0 auto;
    }
    .sub-card {
      border: 1px solid var(--border-light); border-radius: 16px; padding: 28px;
      transition: box-shadow 0.2s;
    }
    .sub-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); }
    .sub-card-icon {
      font-size: 1.6rem; margin-bottom: 14px;
    }
    .sub-card h3 { font-size: 1rem; font-weight: 700; color: var(--light-text); margin-bottom: 12px; }
    .sub-card ul { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .sub-card ul li { font-size: 0.88rem; color: var(--light-muted); display: flex; gap: 8px; align-items: flex-start; }
    .sub-card ul li::before { content: "→"; color: var(--accent); font-weight: 700; flex-shrink: 0; margin-top: 1px; }
    .sub-link { display: inline-flex; align-items: center; gap: 4px; margin-top: 16px; font-size: 0.85rem; font-weight: 600; color: var(--accent); text-decoration: none; }
    .sub-link:hover { text-decoration: underline; }

    /* ── TABS SHOWCASE ── */
    .tabs-section { padding: 80px 5%; background: var(--light-bg); }
    .tabs-section-header { text-align: center; max-width: 700px; margin: 0 auto 48px; }
    .tabs-nav {
      display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;
      background: #e9eef4; border-radius: 12px; padding: 4px;
      max-width: fit-content; margin: 0 auto 40px;
    }
    .tab-btn {
      padding: 8px 20px; border-radius: 9px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 600; color: var(--light-muted);
      background: transparent; transition: all 0.2s;
    }
    .tab-btn.active {
      background: #fff; color: var(--light-text);
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    .tab-content { max-width: 1000px; margin: 0 auto; }
    .tab-panel { display: none; }
    .tab-panel.active { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
    .tab-visual {
      background: var(--dark); border-radius: 16px; padding: 24px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.12);
    }
    .tv-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .tv-title { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .tv-status { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 100px; }
    .tv-status.paid { background: rgba(34,197,94,0.15); color: #22c55e; }
    .tv-status.sent { background: rgba(59,130,246,0.15); color: #3b82f6; }
    .tv-status.pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .tv-amount { font-size: 2rem; font-weight: 900; color: #fff; letter-spacing: -1px; margin-bottom: 4px; }
    .tv-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 20px; }
    .tv-rows { display: flex; flex-direction: column; gap: 7px; }
    .tv-row {
      background: rgba(255,255,255,0.04); border-radius: 7px;
      height: 32px; display: flex; align-items: center; padding: 0 12px; gap: 10px;
    }
    .tv-row-line { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.1); flex: 1; }
    .tv-row-val { font-size: 0.82rem; font-weight: 700; color: rgba(255,255,255,0.6); white-space: nowrap; }
    .tab-info h3 { font-size: 1.3rem; font-weight: 800; color: var(--light-text); letter-spacing: -0.5px; margin-bottom: 12px; }
    .tab-info p { font-size: 0.95rem; color: var(--light-muted); line-height: 1.7; margin-bottom: 20px; }
    .tab-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .tab-pill {
      display: inline-flex; align-items: center; gap: 6px;
      background: color-mix(in srgb, var(--accent) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
      color: var(--accent); font-size: 0.8rem; font-weight: 600;
      padding: 5px 12px; border-radius: 100px;
    }
    /* Tab JS */
    .tabs-nav .tab-btn { cursor: pointer; }

    /* ── TESTIMONIAL + STATS ── */
    .testimonial { padding: 80px 5%; background: var(--dark); }
    .testimonial-inner { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
    .t-quote {
      font-size: 1.4rem; font-weight: 700; color: #fff;
      line-height: 1.5; letter-spacing: -0.3px; margin-bottom: 28px;
      position: relative; padding-left: 24px;
    }
    .t-quote::before {
      content: '"'; position: absolute; left: 0; top: -8px;
      font-size: 3rem; color: var(--accent); line-height: 1; opacity: 0.6;
    }
    .t-author { display: flex; align-items: center; gap: 14px; }
    .t-avatar {
      width: 48px; height: 48px; border-radius: 50%;
      background: var(--accent); opacity: 0.85;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; color: #fff; font-size: 1rem; flex-shrink: 0;
    }
    .t-name { font-weight: 700; color: #fff; font-size: 0.95rem; }
    .t-role { color: var(--text-muted); font-size: 0.85rem; margin-top: 2px; }
    .t-stats { display: flex; flex-direction: column; gap: 24px; }
    .t-stat {
      border-left: 2px solid var(--accent); padding-left: 20px;
    }
    .t-stat-value { font-size: 2.4rem; font-weight: 900; color: #fff; letter-spacing: -1.5px; line-height: 1; }
    .t-stat-value span { color: var(--accent); }
    .t-stat-label { color: var(--text-muted); font-size: 0.88rem; margin-top: 4px; }

    /* ── RELATED MODULES ── */
    .related { padding: 80px 5%; }
    .related-header { max-width: 1100px; margin: 0 auto 40px; }
    .related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1100px; margin: 0 auto; }
    .related-card {
      border: 1px solid var(--border-light); border-radius: 16px; padding: 28px;
      transition: box-shadow 0.2s, border-color 0.2s;
    }
    .related-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
    .related-visual {
      background: var(--light-bg); border-radius: 10px;
      height: 100px; margin-bottom: 20px;
      display: flex; flex-direction: column; gap: 6px; padding: 14px;
      border: 1px solid var(--border-light);
    }
    .rv-bar { height: 7px; border-radius: 4px; background: #e2e8f0; }
    .rv-bar.accent { background: var(--accent); opacity: 0.4; width: 60%; }
    .rv-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; }
    .rv-mini { background: #fff; border-radius: 6px; }
    .related-card h3 { font-size: 1rem; font-weight: 700; color: var(--light-text); margin-bottom: 8px; }
    .related-card p { font-size: 0.88rem; color: var(--light-muted); line-height: 1.6; margin-bottom: 16px; }
    .related-link { font-size: 0.85rem; font-weight: 600; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    .related-link:hover { text-decoration: underline; }

    /* ── FAQ ── */
    .faq { padding: 80px 5%; background: var(--light-bg); }
    .faq-inner { max-width: 760px; margin: 0 auto; }
    .faq-header { margin-bottom: 40px; }
    .faq-item { border-bottom: 1px solid var(--border-light); }
    .faq-q {
      width: 100%; text-align: left; background: none; border: none; cursor: pointer;
      padding: 20px 0; display: flex; justify-content: space-between; align-items: center; gap: 16px;
      font-size: 1rem; font-weight: 700; color: var(--light-text); font-family: var(--font);
    }
    .faq-q:hover { color: var(--accent); }
    .faq-chevron { font-size: 1.1rem; color: var(--light-muted); transition: transform 0.3s; flex-shrink: 0; }
    .faq-a { overflow: hidden; max-height: 0; transition: max-height 0.3s ease; }
    .faq-a p { padding-bottom: 20px; font-size: 0.92rem; color: var(--light-muted); line-height: 1.75; }
    .faq-item.open .faq-chevron { transform: rotate(180deg); }
    .faq-item.open .faq-a { max-height: 300px; }

    /* ── FINAL CTA ── */
    .cta-final { background: var(--dark); padding: 100px 5%; }
    .cta-final-inner { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
    .cta-final h2 {
      font-size: clamp(2rem, 3.5vw, 3rem);
      font-weight: 900; color: #fff;
      letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px;
    }
    .cta-final h2 em { color: var(--accent); font-style: normal; }
    .cta-final p { color: var(--text-muted); font-size: 1rem; margin-bottom: 36px; line-height: 1.7; }
    .cta-btns { display: flex; gap: 14px; flex-wrap: wrap; }
    .cta-visual {
      background: var(--dark2); border: 1px solid var(--border);
      border-radius: 20px; padding: 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .cv-top { display: flex; gap: 8px; margin-bottom: 18px; }
    .cv-dot { width: 9px; height: 9px; border-radius: 50%; }
    .cv-dot:nth-child(1) { background: #ef4444; }
    .cv-dot:nth-child(2) { background: #f59e0b; }
    .cv-dot:nth-child(3) { background: #22c55e; }
    .cv-body { display: flex; flex-direction: column; gap: 10px; }
    .cv-row { display: flex; gap: 10px; }
    .cv-block { height: 60px; border-radius: 8px; background: rgba(255,255,255,0.05); flex: 1; }
    .cv-block.accent { background: color-mix(in srgb, var(--accent) 18%, transparent); }
    .cv-line { height: 7px; border-radius: 4px; background: rgba(255,255,255,0.07); }
    .cv-line.short { width: 55%; }
    .cv-pills { display: flex; gap: 8px; }
    .cv-pill { height: 24px; border-radius: 100px; background: rgba(255,255,255,0.05); flex: 1; }
    .cv-pill.accent { background: var(--accent); opacity: 0.5; flex: 0 0 60px; }

    /* ── FOOTER ── */
    footer { background: #080d17; padding: 60px 5% 32px; color: var(--text-muted); }
    .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; margin-bottom: 48px; }
    .footer-brand { font-size: 1.3rem; font-weight: 800; color: #fff; margin-bottom: 12px; }
    .footer-brand span { color: var(--accent); }
    .footer-desc { font-size: 0.88rem; line-height: 1.7; }
    .footer-col h4 { color: #fff; font-size: 0.88rem; font-weight: 700; margin-bottom: 16px; }
    .footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .footer-col ul a { color: var(--text-muted); text-decoration: none; font-size: 0.88rem; transition: color 0.2s; }
    .footer-col ul a:hover { color: #fff; }
    .footer-bottom {
      border-top: 1px solid var(--border); padding-top: 24px;
      display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 900px) {
      .hero-inner { grid-template-columns: 1fr; }
      .hero-visual { display: none; }
      .feature-block { grid-template-columns: 1fr; gap: 40px; }
      .feature-block.flip { direction: ltr; }
      .adv-grid { grid-template-columns: repeat(2, 1fr); }
      .sub-grid { grid-template-columns: 1fr; }
      .testimonial-inner { grid-template-columns: 1fr; }
      .related-grid { grid-template-columns: 1fr; }
      .cta-final-inner { grid-template-columns: 1fr; }
      .cta-visual { display: none; }
      .footer-grid { grid-template-columns: 1fr 1fr; gap: 32px; }
      .tab-panel.active { grid-template-columns: 1fr; }
      .tab-visual { display: none; }
    }
    @media (max-width: 600px) {
      .nav-links { display: none; }
      .adv-grid { grid-template-columns: 1fr; }
      .footer-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <!-- NAVBAR -->
  <nav>
    <a class="nav-logo" href="/">{{app_name}}<span>.</span></a>
    <ul class="nav-links">
      <li><a href="{{nav_link_1_url}}">{{nav_link_1}}</a></li>
      <li><a href="{{nav_link_2_url}}">{{nav_link_2}}</a></li>
      <li><a href="{{nav_link_3_url}}" class="active">{{nav_link_3}}</a></li>
      <li><a href="{{nav_link_4_url}}">{{nav_link_4}}</a></li>
    </ul>
    <div class="nav-ctas">
      <a href="{{login_url}}" class="btn-ghost">{{nav_login}}</a>
      <a href="{{signup_url}}" class="btn-primary">{{nav_cta}}</a>
    </div>
  </nav>

  <!-- HERO FEATURE -->
  <section class="hero">
    <div class="hero-inner">
      <div class="hero-content">
        <div class="hero-badge"><span class="hero-badge-dot"></span>{{hero_badge}}</div>
        <h1>{{hero_title}}<br><em>{{hero_title_accent}}</em></h1>
        <p>{{hero_subtitle}}</p>
        <div class="hero-ctas">
          <a href="{{signup_url}}" class="btn-hero">{{hero_cta_primary}}</a>
          <a href="{{demo_url}}" class="btn-hero-outline">{{hero_cta_secondary}}</a>
        </div>
        <div class="hero-meta">
          <span class="hero-meta-item">✓ {{hero_meta_1}}</span>
          <span class="hero-meta-item">✓ {{hero_meta_2}}</span>
          <span class="hero-meta-item">✓ {{hero_meta_3}}</span>
        </div>
      </div>
      <div class="hero-visual">
        <div class="hero-screen">
          <div class="hs-bar">
            <div class="hs-dot"></div><div class="hs-dot"></div><div class="hs-dot"></div>
          </div>
          <div class="hs-body">
            <div class="hs-header">
              <div class="hs-title"></div>
              <div class="hs-pill"></div>
            </div>
            <div class="hs-kpis">
              <div class="hs-kpi"><div class="hs-kpi-label"></div><div class="hs-kpi-value accent">{{hero_kpi_1}}</div></div>
              <div class="hs-kpi"><div class="hs-kpi-label"></div><div class="hs-kpi-value">{{hero_kpi_2}}</div></div>
              <div class="hs-kpi"><div class="hs-kpi-label"></div><div class="hs-kpi-value">{{hero_kpi_3}}</div></div>
            </div>
            <div class="hs-list">
              <div class="hs-row"><div class="hs-row-dot"></div><div class="hs-row-line"></div><div class="hs-row-tag"></div></div>
              <div class="hs-row"><div class="hs-row-dot"></div><div class="hs-row-line"></div><div class="hs-row-tag"></div></div>
              <div class="hs-row"><div class="hs-row-dot"></div><div class="hs-row-line"></div><div class="hs-row-tag"></div></div>
              <div class="hs-row"><div class="hs-row-dot"></div><div class="hs-row-line"></div><div class="hs-row-tag"></div></div>
            </div>
          </div>
        </div>
        <div class="hero-float">
          <div class="hf-icon">{{hero_float_icon}}</div>
          <div><div class="hf-label">{{hero_float_label}}</div><div class="hf-value">{{hero_float_value}}</div></div>
        </div>
      </div>
    </div>
  </section>

  <!-- TRUST LOGOS -->
  <section class="logos">
    <p class="logos-label">{{logos_label}}</p>
    <div class="logos-grid">
      <div class="logo-item">{{logo_1}}</div>
      <div class="logo-item">{{logo_2}}</div>
      <div class="logo-item">{{logo_3}}</div>
      <div class="logo-item">{{logo_4}}</div>
      <div class="logo-item">{{logo_5}}</div>
    </div>
  </section>

  <!-- FEATURE DEEP-DIVE BLOCKS -->
  <section class="features" id="features">

    <!-- Feature 1 -->
    <div class="feature-block">
      <div class="feature-visual">
        <div class="feature-visual-inner">
          <div class="fv-row"><div class="fv-pill accent"></div><div class="fv-pill"></div><div class="fv-pill"></div></div>
          <div class="fv-row" style="flex:1">
            <div class="fv-block"></div>
            <div class="fv-block accent"></div>
          </div>
          <div class="fv-row"><div class="fv-line"></div></div>
          <div class="fv-row"><div class="fv-line short"></div></div>
        </div>
      </div>
      <div>
        <div class="section-label">{{feat1_label}}</div>
        <h2 class="section-title">{{feat1_title}}</h2>
        <p class="section-sub">{{feat1_desc}}</p>
        <ul class="feature-points">
          <li><div class="fp-icon">✦</div><div><div class="fp-title">{{feat1_point1_title}}</div><div class="fp-desc">{{feat1_point1_desc}}</div></div></li>
          <li><div class="fp-icon">⚡</div><div><div class="fp-title">{{feat1_point2_title}}</div><div class="fp-desc">{{feat1_point2_desc}}</div></div></li>
          <li><div class="fp-icon">◎</div><div><div class="fp-title">{{feat1_point3_title}}</div><div class="fp-desc">{{feat1_point3_desc}}</div></div></li>
        </ul>
        <div style="margin-top:28px"><a href="{{signup_url}}" class="btn-cta">{{feat1_cta}}</a></div>
      </div>
    </div>

    <!-- Feature 2 -->
    <div class="feature-block flip">
      <div class="feature-visual">
        <div class="feature-visual-inner">
          <div class="fv-grid">
            <div class="fv-mini"><div class="fv-mini-line"></div><div class="fv-mini-val accent">{{feat2_kpi1}}</div></div>
            <div class="fv-mini"><div class="fv-mini-line"></div><div class="fv-mini-val">{{feat2_kpi2}}</div></div>
            <div class="fv-mini"><div class="fv-mini-line"></div><div class="fv-mini-val">{{feat2_kpi3}}</div></div>
            <div class="fv-mini"><div class="fv-mini-line"></div><div class="fv-mini-val accent">{{feat2_kpi4}}</div></div>
          </div>
          <div class="fv-row"><div class="fv-line"></div></div>
          <div class="fv-row"><div class="fv-pill"></div><div class="fv-pill accent"></div></div>
        </div>
      </div>
      <div>
        <div class="section-label">{{feat2_label}}</div>
        <h2 class="section-title">{{feat2_title}}</h2>
        <p class="section-sub">{{feat2_desc}}</p>
        <ul class="feature-points">
          <li><div class="fp-icon">▲</div><div><div class="fp-title">{{feat2_point1_title}}</div><div class="fp-desc">{{feat2_point1_desc}}</div></div></li>
          <li><div class="fp-icon">◈</div><div><div class="fp-title">{{feat2_point2_title}}</div><div class="fp-desc">{{feat2_point2_desc}}</div></div></li>
          <li><div class="fp-icon">✧</div><div><div class="fp-title">{{feat2_point3_title}}</div><div class="fp-desc">{{feat2_point3_desc}}</div></div></li>
        </ul>
        <div style="margin-top:28px"><a href="{{signup_url}}" class="btn-cta">{{feat2_cta}}</a></div>
      </div>
    </div>

    <!-- Feature 3 -->
    <div class="feature-block">
      <div class="feature-visual">
        <div class="feature-visual-inner">
          <div class="fv-row"><div class="fv-pill"></div><div class="fv-pill"></div><div class="fv-pill accent"></div></div>
          <div class="fv-row" style="flex:1"><div class="fv-block"></div></div>
          <div class="fv-row"><div class="fv-line short"></div></div>
          <div class="fv-row"><div class="fv-line"></div></div>
        </div>
      </div>
      <div>
        <div class="section-label">{{feat3_label}}</div>
        <h2 class="section-title">{{feat3_title}}</h2>
        <p class="section-sub">{{feat3_desc}}</p>
        <ul class="feature-points">
          <li><div class="fp-icon">⊕</div><div><div class="fp-title">{{feat3_point1_title}}</div><div class="fp-desc">{{feat3_point1_desc}}</div></div></li>
          <li><div class="fp-icon">⊞</div><div><div class="fp-title">{{feat3_point2_title}}</div><div class="fp-desc">{{feat3_point2_desc}}</div></div></li>
          <li><div class="fp-icon">⊗</div><div><div class="fp-title">{{feat3_point3_title}}</div><div class="fp-desc">{{feat3_point3_desc}}</div></div></li>
        </ul>
        <div style="margin-top:28px"><a href="{{signup_url}}" class="btn-cta">{{feat3_cta}}</a></div>
      </div>
    </div>

  </section>

  <!-- ADVANCED / AI FEATURES GRID -->
  <section class="adv-features">
    <div class="adv-features-header">
      <div class="section-label" style="color:var(--accent)">{{adv_section_label}}</div>
      <h2 class="section-title">{{adv_section_title}}</h2>
      <p class="section-sub">{{adv_section_desc}}</p>
    </div>
    <div class="adv-grid">
      <div class="adv-card">
        <div class="adv-icon">{{adv1_icon}}</div>
        <h3>{{adv1_title}}</h3>
        <p>{{adv1_desc}}</p>
      </div>
      <div class="adv-card">
        <div class="adv-icon">{{adv2_icon}}</div>
        <h3>{{adv2_title}}</h3>
        <p>{{adv2_desc}}</p>
      </div>
      <div class="adv-card">
        <div class="adv-icon">{{adv3_icon}}</div>
        <h3>{{adv3_title}}</h3>
        <p>{{adv3_desc}}</p>
        <span class="adv-badge">{{adv3_badge}}</span>
      </div>
      <div class="adv-card">
        <div class="adv-icon">{{adv4_icon}}</div>
        <h3>{{adv4_title}}</h3>
        <p>{{adv4_desc}}</p>
      </div>
      <div class="adv-card">
        <div class="adv-icon">{{adv5_icon}}</div>
        <h3>{{adv5_title}}</h3>
        <p>{{adv5_desc}}</p>
      </div>
      <div class="adv-card">
        <div class="adv-icon">{{adv6_icon}}</div>
        <h3>{{adv6_title}}</h3>
        <p>{{adv6_desc}}</p>
      </div>
    </div>
  </section>

  <!-- SUB-FEATURES DETAIL GRID -->
  <section class="sub-features">
    <div class="sub-features-header">
      <div class="section-label">{{sub_section_label}}</div>
      <h2 class="section-title">{{sub_section_title}}</h2>
    </div>
    <div class="sub-grid">
      <div class="sub-card">
        <div class="sub-card-icon">{{sub1_icon}}</div>
        <h3>{{sub1_title}}</h3>
        <ul>
          <li>{{sub1_bullet1}}</li>
          <li>{{sub1_bullet2}}</li>
          <li>{{sub1_bullet3}}</li>
        </ul>
        <a href="#" class="sub-link">{{sub1_link}} →</a>
      </div>
      <div class="sub-card">
        <div class="sub-card-icon">{{sub2_icon}}</div>
        <h3>{{sub2_title}}</h3>
        <ul>
          <li>{{sub2_bullet1}}</li>
          <li>{{sub2_bullet2}}</li>
          <li>{{sub2_bullet3}}</li>
        </ul>
        <a href="#" class="sub-link">{{sub2_link}} →</a>
      </div>
      <div class="sub-card">
        <div class="sub-card-icon">{{sub3_icon}}</div>
        <h3>{{sub3_title}}</h3>
        <ul>
          <li>{{sub3_bullet1}}</li>
          <li>{{sub3_bullet2}}</li>
          <li>{{sub3_bullet3}}</li>
        </ul>
        <a href="#" class="sub-link">{{sub3_link}} →</a>
      </div>
      <div class="sub-card">
        <div class="sub-card-icon">{{sub4_icon}}</div>
        <h3>{{sub4_title}}</h3>
        <ul>
          <li>{{sub4_bullet1}}</li>
          <li>{{sub4_bullet2}}</li>
          <li>{{sub4_bullet3}}</li>
        </ul>
        <a href="#" class="sub-link">{{sub4_link}} →</a>
      </div>
    </div>
  </section>

  <!-- TABS SHOWCASE -->
  <section class="tabs-section">
    <div class="tabs-section-header">
      <div class="section-label">{{tabs_section_label}}</div>
      <h2 class="section-title">{{tabs_section_title}}</h2>
      <p class="section-sub" style="margin:0 auto">{{tabs_section_desc}}</p>
    </div>
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab(this,'tab1')">{{tab1_name}}</button>
      <button class="tab-btn" onclick="switchTab(this,'tab2')">{{tab2_name}}</button>
      <button class="tab-btn" onclick="switchTab(this,'tab3')">{{tab3_name}}</button>
      <button class="tab-btn" onclick="switchTab(this,'tab4')">{{tab4_name}}</button>
    </div>
    <div class="tab-content">
      <div id="tab1" class="tab-panel active">
        <div class="tab-visual">
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
      <div id="tab2" class="tab-panel">
        <div class="tab-visual">
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
      <div id="tab3" class="tab-panel">
        <div class="tab-visual">
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
      <div id="tab4" class="tab-panel">
        <div class="tab-visual">
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

  <!-- TESTIMONIAL + STATS -->
  <section class="testimonial">
    <div class="testimonial-inner">
      <div>
        <p class="t-quote">{{testimonial_quote}}</p>
        <div class="t-author">
          <div class="t-avatar">{{testimonial_initials}}</div>
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

  <!-- RELATED MODULES -->
  <section class="related">
    <div class="related-header">
      <div class="section-label">{{related_label}}</div>
      <h2 class="section-title">{{related_title}}</h2>
    </div>
    <div class="related-grid">
      <div class="related-card">
        <div class="related-visual">
          <div class="rv-bar accent"></div>
          <div class="rv-mini-grid"><div class="rv-mini"></div><div class="rv-mini"></div></div>
        </div>
        <h3>{{related1_title}}</h3>
        <p>{{related1_desc}}</p>
        <a href="{{related1_url}}" class="related-link">{{related1_cta}} →</a>
      </div>
      <div class="related-card">
        <div class="related-visual">
          <div class="rv-bar"></div>
          <div class="rv-bar accent"></div>
          <div class="rv-mini-grid"><div class="rv-mini"></div><div class="rv-mini"></div></div>
        </div>
        <h3>{{related2_title}}</h3>
        <p>{{related2_desc}}</p>
        <a href="{{related2_url}}" class="related-link">{{related2_cta}} →</a>
      </div>
      <div class="related-card">
        <div class="related-visual">
          <div class="rv-mini-grid" style="height:100%"><div class="rv-mini"></div><div class="rv-mini"></div><div class="rv-mini"></div><div class="rv-mini"></div></div>
        </div>
        <h3>{{related3_title}}</h3>
        <p>{{related3_desc}}</p>
        <a href="{{related3_url}}" class="related-link">{{related3_cta}} →</a>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="faq">
    <div class="faq-inner">
      <div class="faq-header">
        <div class="section-label">{{faq_label}}</div>
        <h2 class="section-title">{{faq_title}}</h2>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">{{faq1_q}}<span class="faq-chevron">▾</span></button>
        <div class="faq-a"><p>{{faq1_a}}</p></div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">{{faq2_q}}<span class="faq-chevron">▾</span></button>
        <div class="faq-a"><p>{{faq2_a}}</p></div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">{{faq3_q}}<span class="faq-chevron">▾</span></button>
        <div class="faq-a"><p>{{faq3_a}}</p></div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">{{faq4_q}}<span class="faq-chevron">▾</span></button>
        <div class="faq-a"><p>{{faq4_a}}</p></div>
      </div>
      <div class="faq-item">
        <button class="faq-q" onclick="toggleFaq(this)">{{faq5_q}}<span class="faq-chevron">▾</span></button>
        <div class="faq-a"><p>{{faq5_a}}</p></div>
      </div>
    </div>
  </section>

  <!-- FINAL CTA -->
  <section class="cta-final">
    <div class="cta-final-inner">
      <div>
        <h2>{{cta_title}}<br><em>{{cta_title_accent}}</em></h2>
        <p>{{cta_subtitle}}</p>
        <div class="cta-btns">
          <a href="{{signup_url}}" class="btn-hero">{{cta_primary}}</a>
          <a href="{{demo_url}}" class="btn-hero-outline">{{cta_secondary}}</a>
        </div>
      </div>
      <div class="cta-visual">
        <div class="cv-top"><div class="cv-dot"></div><div class="cv-dot"></div><div class="cv-dot"></div></div>
        <div class="cv-body">
          <div class="cv-row"><div class="cv-block accent"></div><div class="cv-block"></div></div>
          <div class="cv-line"></div>
          <div class="cv-line short"></div>
          <div class="cv-pills"><div class="cv-pill accent"></div><div class="cv-pill"></div><div class="cv-pill"></div></div>
          <div class="cv-row"><div class="cv-block"></div><div class="cv-block accent"></div></div>
        </div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer>
    <div class="footer-grid">
      <div>
        <div class="footer-brand">{{app_name}}<span>.</span></div>
        <p class="footer-desc">{{footer_desc}}</p>
      </div>
      <div class="footer-col">
        <h4>{{footer_col1_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col1_link1}}</a></li>
          <li><a href="#">{{footer_col1_link2}}</a></li>
          <li><a href="#">{{footer_col1_link3}}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>{{footer_col2_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col2_link1}}</a></li>
          <li><a href="#">{{footer_col2_link2}}</a></li>
          <li><a href="#">{{footer_col2_link3}}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>{{footer_col3_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col3_link1}}</a></li>
          <li><a href="#">{{footer_col3_link2}}</a></li>
          <li><a href="#">{{footer_col3_link3}}</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>{{footer_copyright}}</span>
      <span>{{footer_links}}</span>
    </div>
  </footer>

  <script>
    function switchTab(btn, tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }
    function toggleFaq(btn) {
      const item = btn.parentElement;
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    }
  </script>

</body>
</html>
`
