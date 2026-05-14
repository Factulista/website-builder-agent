export const SAAS_TEMPLATE = `<!DOCTYPE html>
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

    /* ── ANNOUNCEMENT BAR ── */
    .announcement {
      background: var(--accent);
      color: #fff;
      text-align: center;
      padding: 10px 20px;
      font-size: 0.88rem;
      font-weight: 500;
    }
    .announcement a { color: #fff; text-decoration: underline; }

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
    .nav-ctas { display: flex; gap: 12px; align-items: center; }
    .btn-ghost { background: transparent; color: #fff; border: 1px solid var(--border); padding: 8px 18px; border-radius: 8px; font-size: 0.88rem; font-weight: 500; cursor: pointer; text-decoration: none; transition: border-color 0.2s; }
    .btn-ghost:hover { border-color: rgba(255,255,255,0.3); }
    .btn-primary { background: var(--accent); color: #fff; border: none; padding: 8px 20px; border-radius: 8px; font-size: 0.88rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity 0.2s; }
    .btn-primary:hover { opacity: 0.9; }

    /* ── HERO ── */
    .hero {
      background: var(--dark);
      padding: 100px 5% 0;
      text-align: center;
      overflow: hidden;
    }
    .hero-label {
      display: inline-block;
      background: rgba(255,255,255,0.08);
      color: var(--text-muted);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 100px;
      margin-bottom: 24px;
    }
    .hero h1 {
      font-size: clamp(2.4rem, 5vw, 4rem);
      font-weight: 900;
      color: #fff;
      line-height: 1.1;
      letter-spacing: -1.5px;
      max-width: 800px;
      margin: 0 auto 20px;
    }
    .hero h1 .dot { color: var(--accent); }
    .hero p {
      font-size: 1.15rem;
      color: var(--text-muted);
      max-width: 560px;
      margin: 0 auto 40px;
      line-height: 1.7;
    }
    .hero-ctas { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px; }
    .btn-hero {
      background: #fff; color: var(--dark);
      padding: 14px 28px; border-radius: 10px;
      font-size: 1rem; font-weight: 700;
      text-decoration: none; transition: opacity 0.2s;
    }
    .btn-hero:hover { opacity: 0.9; }
    .btn-hero-outline {
      background: transparent; color: #fff;
      border: 1px solid rgba(255,255,255,0.25);
      padding: 14px 28px; border-radius: 10px;
      font-size: 1rem; font-weight: 600;
      text-decoration: none; transition: border-color 0.2s;
    }
    .btn-hero-outline:hover { border-color: rgba(255,255,255,0.6); }
    .social-proof {
      color: var(--text-muted); font-size: 0.85rem;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-bottom: 60px;
    }
    .stars { color: #f59e0b; letter-spacing: 2px; }
    .hero-mockup {
      background: var(--dark2);
      border: 1px solid var(--border);
      border-radius: 16px 16px 0 0;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      box-shadow: 0 -20px 80px rgba(0,0,0,0.4);
    }
    .mockup-bar {
      display: flex; gap: 6px; margin-bottom: 16px;
    }
    .mockup-dot { width: 10px; height: 10px; border-radius: 50%; }
    .mockup-dot:nth-child(1) { background: #ef4444; }
    .mockup-dot:nth-child(2) { background: #f59e0b; }
    .mockup-dot:nth-child(3) { background: #22c55e; }
    .mockup-screen {
      background: #1e2d45;
      border-radius: 8px;
      height: 340px;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
      position: relative;
    }
    .mockup-ui {
      width: 100%; height: 100%;
      display: grid; grid-template-columns: 200px 1fr;
    }
    .mockup-sidebar {
      background: #162032;
      padding: 20px 16px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .mockup-nav-item {
      height: 32px; border-radius: 6px;
      background: rgba(255,255,255,0.05);
      display: flex; align-items: center; padding: 0 12px; gap: 8px;
    }
    .mockup-nav-item.active { background: var(--accent); opacity: 0.8; }
    .mockup-nav-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.2); flex-shrink: 0; }
    .mockup-nav-line { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.15); flex: 1; }
    .mockup-content { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .mockup-row { display: flex; gap: 12px; }
    .mockup-card {
      background: #1a2d44;
      border-radius: 8px; padding: 16px;
      flex: 1;
    }
    .mockup-card-line { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.1); margin-bottom: 8px; }
    .mockup-card-line.short { width: 60%; }
    .mockup-card-value { font-size: 1.4rem; font-weight: 700; color: #fff; }
    .mockup-table { background: #1a2d44; border-radius: 8px; padding: 12px; flex: 1; }
    .mockup-table-row { height: 28px; border-radius: 4px; background: rgba(255,255,255,0.05); margin-bottom: 6px; }
    .mockup-table-row:first-child { background: rgba(255,255,255,0.08); }

    /* ── LOGOS ── */
    .logos {
      padding: 60px 5%;
      text-align: center;
      background: var(--light-bg);
    }
    .logos p { color: var(--light-muted); font-size: 0.85rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 32px; }
    .logos-grid {
      display: flex; align-items: center; justify-content: center;
      gap: 48px; flex-wrap: wrap;
    }
    .logo-item {
      font-size: 1.1rem; font-weight: 800; color: #cbd5e1;
      letter-spacing: -0.5px;
    }

    /* ── FEATURES ── */
    .features { padding: 100px 5%; }
    .section-label {
      font-size: 0.8rem; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; color: var(--accent);
      margin-bottom: 12px;
    }
    .section-title {
      font-size: clamp(1.8rem, 3vw, 2.6rem);
      font-weight: 800; color: var(--light-text);
      letter-spacing: -1px; line-height: 1.15;
      max-width: 600px; margin-bottom: 16px;
    }
    .section-sub {
      color: var(--light-muted); font-size: 1.05rem;
      max-width: 520px; line-height: 1.7; margin-bottom: 40px;
    }
    .feature-block {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 80px; align-items: center;
      margin-bottom: 100px;
    }
    .feature-block.reverse { direction: rtl; }
    .feature-block.reverse > * { direction: ltr; }
    .feature-visual {
      background: var(--light-bg);
      border-radius: 20px;
      aspect-ratio: 4/3;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; position: relative;
      border: 1px solid var(--border-light);
    }
    .feature-visual-inner {
      width: 85%; height: 85%;
      background: var(--dark2);
      border-radius: 12px;
      display: flex; flex-direction: column; gap: 10px;
      padding: 20px;
    }
    .fv-row { display: flex; gap: 10px; }
    .fv-pill { height: 28px; border-radius: 100px; background: rgba(255,255,255,0.08); flex: 1; }
    .fv-pill.accent { background: var(--accent); opacity: 0.7; flex: 0 0 80px; }
    .fv-block { height: 80px; border-radius: 8px; background: rgba(255,255,255,0.05); flex: 1; }
    .fv-line { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.08); }
    .fv-line.short { width: 40%; }
    .feature-points { list-style: none; display: flex; flex-direction: column; gap: 20px; }
    .feature-points li { display: flex; gap: 12px; align-items: flex-start; }
    .fp-icon {
      width: 32px; height: 32px; border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 1rem; flex-shrink: 0; margin-top: 2px;
    }
    .fp-title { font-weight: 700; color: var(--light-text); margin-bottom: 4px; }
    .fp-desc { color: var(--light-muted); font-size: 0.92rem; line-height: 1.6; }

    /* ── STATS ── */
    .stats { background: var(--dark); padding: 80px 5%; }
    .stats-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 40px; text-align: center;
    }
    .stat-number {
      font-size: 3rem; font-weight: 900; color: #fff;
      letter-spacing: -2px; line-height: 1;
    }
    .stat-number span { color: var(--accent); }
    .stat-label { color: var(--text-muted); font-size: 0.92rem; margin-top: 8px; }

    /* ── TESTIMONIALS ── */
    .testimonials { padding: 100px 5%; background: var(--light-bg); }
    .testimonials-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }
    .testimonial-card {
      background: #fff; border-radius: 16px; padding: 28px;
      border: 1px solid var(--border-light);
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .tc-stars { color: #f59e0b; font-size: 1rem; margin-bottom: 16px; }
    .tc-quote { color: var(--light-text); font-size: 0.95rem; line-height: 1.7; margin-bottom: 20px; }
    .tc-author { display: flex; align-items: center; gap: 12px; }
    .tc-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--accent); opacity: 0.8;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; color: #fff; font-size: 0.9rem;
    }
    .tc-name { font-weight: 700; font-size: 0.9rem; color: var(--light-text); }
    .tc-role { font-size: 0.82rem; color: var(--light-muted); }

    /* ── PRICING ── */
    .pricing { padding: 100px 5%; }
    .pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }
    .pricing-card {
      border: 1px solid var(--border-light);
      border-radius: 20px; padding: 32px;
      position: relative;
    }
    .pricing-card.featured {
      background: var(--dark);
      border-color: transparent;
    }
    .pricing-badge {
      position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
      background: var(--accent); color: #fff;
      font-size: 0.75rem; font-weight: 700;
      padding: 4px 14px; border-radius: 100px;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    .plan-name { font-weight: 700; font-size: 0.9rem; color: var(--light-muted); margin-bottom: 8px; }
    .pricing-card.featured .plan-name { color: var(--text-muted); }
    .plan-price {
      font-size: 3rem; font-weight: 900; color: var(--light-text);
      letter-spacing: -2px; line-height: 1; margin-bottom: 4px;
    }
    .pricing-card.featured .plan-price { color: #fff; }
    .plan-period { font-size: 0.85rem; color: var(--light-muted); margin-bottom: 24px; }
    .pricing-card.featured .plan-period { color: var(--text-muted); }
    .plan-features { list-style: none; display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
    .plan-features li { font-size: 0.9rem; color: var(--light-text); display: flex; gap: 8px; align-items: center; }
    .pricing-card.featured .plan-features li { color: rgba(255,255,255,0.8); }
    .plan-features li::before { content: "✓"; color: var(--accent); font-weight: 700; flex-shrink: 0; }
    .btn-plan {
      display: block; width: 100%; text-align: center;
      padding: 12px; border-radius: 10px;
      font-weight: 700; font-size: 0.95rem; text-decoration: none;
      border: 1px solid var(--border-light); color: var(--light-text);
      transition: all 0.2s;
    }
    .btn-plan:hover { border-color: var(--accent); color: var(--accent); }
    .pricing-card.featured .btn-plan {
      background: var(--accent); color: #fff; border-color: transparent;
    }
    .pricing-card.featured .btn-plan:hover { opacity: 0.9; }

    /* ── CTA FINALE ── */
    .cta-final {
      background: var(--dark); padding: 100px 5%;
      text-align: center;
    }
    .cta-final h2 {
      font-size: clamp(2rem, 4vw, 3.2rem);
      font-weight: 900; color: #fff;
      letter-spacing: -1.5px; margin-bottom: 16px;
    }
    .cta-final p { color: var(--text-muted); font-size: 1.1rem; margin-bottom: 40px; }
    .cta-final-btns { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }

    /* ── FOOTER ── */
    footer {
      background: #080d17;
      padding: 60px 5% 32px;
      color: var(--text-muted);
    }
    .footer-grid {
      display: grid; grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: 48px; margin-bottom: 48px;
    }
    .footer-brand { font-size: 1.3rem; font-weight: 800; color: #fff; margin-bottom: 12px; }
    .footer-brand span { color: var(--accent); }
    .footer-desc { font-size: 0.88rem; line-height: 1.7; }
    .footer-col h4 { color: #fff; font-size: 0.88rem; font-weight: 700; margin-bottom: 16px; }
    .footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 10px; }
    .footer-col ul a { color: var(--text-muted); text-decoration: none; font-size: 0.88rem; transition: color 0.2s; }
    .footer-col ul a:hover { color: #fff; }
    .footer-bottom {
      border-top: 1px solid var(--border);
      padding-top: 24px;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.82rem;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .feature-block { grid-template-columns: 1fr; gap: 40px; }
      .feature-block.reverse { direction: ltr; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; }
      .testimonials-grid { grid-template-columns: 1fr; }
      .pricing-grid { grid-template-columns: 1fr; }
      .footer-grid { grid-template-columns: 1fr 1fr; gap: 32px; }
      .hero h1 { letter-spacing: -0.5px; }
    }
  </style>
</head>
<body>

  <!-- ANNOUNCEMENT BAR -->
  <div class="announcement">{{announcement_text}}</div>

  <!-- NAVBAR -->
  <nav>
    <a class="nav-logo" href="#">{{app_name}}<span>.</span></a>
    <ul class="nav-links">
      <li><a href="#features">{{nav_features}}</a></li>
      <li><a href="#pricing">{{nav_pricing}}</a></li>
      <li><a href="#testimonials">{{nav_testimonials}}</a></li>
    </ul>
    <div class="nav-ctas">
      <a href="{{login_url}}" class="btn-ghost">{{nav_login}}</a>
      <a href="{{signup_url}}" class="btn-primary">{{nav_signup}}</a>
    </div>
  </nav>

  <!-- HERO -->
  <section class="hero">
    <div class="hero-label">{{hero_label}}</div>
    <h1>{{hero_title}}<span class="dot">.</span></h1>
    <p>{{hero_subtitle}}</p>
    <div class="hero-ctas">
      <a href="{{signup_url}}" class="btn-hero">{{hero_cta_primary}}</a>
      <a href="{{demo_url}}" class="btn-hero-outline">{{hero_cta_secondary}}</a>
    </div>
    <div class="social-proof">
      <span class="stars">★★★★★</span>
      <span>{{social_proof_text}}</span>
    </div>
    <!-- App Mockup -->
    <div class="hero-mockup">
      <div class="mockup-bar">
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
        <div class="mockup-dot"></div>
      </div>
      <div class="mockup-screen">
        <div class="mockup-ui">
          <div class="mockup-sidebar">
            <div class="mockup-nav-item active"><div class="mockup-nav-dot"></div><div class="mockup-nav-line"></div></div>
            <div class="mockup-nav-item"><div class="mockup-nav-dot"></div><div class="mockup-nav-line"></div></div>
            <div class="mockup-nav-item"><div class="mockup-nav-dot"></div><div class="mockup-nav-line"></div></div>
            <div class="mockup-nav-item"><div class="mockup-nav-dot"></div><div class="mockup-nav-line"></div></div>
            <div class="mockup-nav-item"><div class="mockup-nav-dot"></div><div class="mockup-nav-line"></div></div>
          </div>
          <div class="mockup-content">
            <div class="mockup-row">
              <div class="mockup-card"><div class="mockup-card-line short"></div><div class="mockup-card-value">{{stat_1_value}}</div></div>
              <div class="mockup-card"><div class="mockup-card-line short"></div><div class="mockup-card-value">{{stat_2_value}}</div></div>
              <div class="mockup-card"><div class="mockup-card-line short"></div><div class="mockup-card-value">{{stat_3_value}}</div></div>
            </div>
            <div class="mockup-table">
              <div class="mockup-table-row"></div>
              <div class="mockup-table-row"></div>
              <div class="mockup-table-row"></div>
              <div class="mockup-table-row"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- LOGOS CLIENTI -->
  <section class="logos">
    <p>{{logos_label}}</p>
    <div class="logos-grid">
      <div class="logo-item">{{logo_1}}</div>
      <div class="logo-item">{{logo_2}}</div>
      <div class="logo-item">{{logo_3}}</div>
      <div class="logo-item">{{logo_4}}</div>
      <div class="logo-item">{{logo_5}}</div>
    </div>
  </section>

  <!-- FEATURES -->
  <section class="features" id="features">

    <!-- Feature 1 -->
    <div class="feature-block">
      <div class="feature-visual">
        <div class="feature-visual-inner">
          <div class="fv-row"><div class="fv-pill accent"></div><div class="fv-pill"></div></div>
          <div class="fv-block"></div>
          <div class="fv-row"><div class="fv-line"></div></div>
          <div class="fv-row"><div class="fv-line short"></div></div>
        </div>
      </div>
      <div>
        <div class="section-label">{{feature_1_label}}</div>
        <h2 class="section-title">{{feature_1_title}}</h2>
        <p class="section-sub">{{feature_1_desc}}</p>
        <ul class="feature-points">
          <li>
            <div class="fp-icon">✦</div>
            <div><div class="fp-title">{{feature_1_point_1_title}}</div><div class="fp-desc">{{feature_1_point_1_desc}}</div></div>
          </li>
          <li>
            <div class="fp-icon">⚡</div>
            <div><div class="fp-title">{{feature_1_point_2_title}}</div><div class="fp-desc">{{feature_1_point_2_desc}}</div></div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Feature 2 -->
    <div class="feature-block reverse">
      <div class="feature-visual">
        <div class="feature-visual-inner">
          <div class="fv-row"><div class="fv-pill"></div><div class="fv-pill accent"></div></div>
          <div class="fv-row"><div class="fv-block"></div><div class="fv-block"></div></div>
          <div class="fv-line short"></div>
        </div>
      </div>
      <div>
        <div class="section-label">{{feature_2_label}}</div>
        <h2 class="section-title">{{feature_2_title}}</h2>
        <p class="section-sub">{{feature_2_desc}}</p>
        <ul class="feature-points">
          <li>
            <div class="fp-icon">◎</div>
            <div><div class="fp-title">{{feature_2_point_1_title}}</div><div class="fp-desc">{{feature_2_point_1_desc}}</div></div>
          </li>
          <li>
            <div class="fp-icon">▲</div>
            <div><div class="fp-title">{{feature_2_point_2_title}}</div><div class="fp-desc">{{feature_2_point_2_desc}}</div></div>
          </li>
        </ul>
      </div>
    </div>

  </section>

  <!-- STATS -->
  <section class="stats">
    <div class="stats-grid">
      <div>
        <div class="stat-number">{{stat_big_1}}<span>+</span></div>
        <div class="stat-label">{{stat_big_1_label}}</div>
      </div>
      <div>
        <div class="stat-number">{{stat_big_2}}<span>%</span></div>
        <div class="stat-label">{{stat_big_2_label}}</div>
      </div>
      <div>
        <div class="stat-number"><span>€</span>{{stat_big_3}}</div>
        <div class="stat-label">{{stat_big_3_label}}</div>
      </div>
      <div>
        <div class="stat-number">{{stat_big_4}}<span>★</span></div>
        <div class="stat-label">{{stat_big_4_label}}</div>
      </div>
    </div>
  </section>

  <!-- TESTIMONIALS -->
  <section class="testimonials" id="testimonials">
    <div class="section-label" style="text-align:center">{{testimonials_label}}</div>
    <h2 class="section-title" style="margin:0 auto;text-align:center">{{testimonials_title}}</h2>
    <div class="testimonials-grid">
      <div class="testimonial-card">
        <div class="tc-stars">★★★★★</div>
        <p class="tc-quote">{{testimonial_1_quote}}</p>
        <div class="tc-author">
          <div class="tc-avatar">{{testimonial_1_initials}}</div>
          <div><div class="tc-name">{{testimonial_1_name}}</div><div class="tc-role">{{testimonial_1_role}}</div></div>
        </div>
      </div>
      <div class="testimonial-card">
        <div class="tc-stars">★★★★★</div>
        <p class="tc-quote">{{testimonial_2_quote}}</p>
        <div class="tc-author">
          <div class="tc-avatar">{{testimonial_2_initials}}</div>
          <div><div class="tc-name">{{testimonial_2_name}}</div><div class="tc-role">{{testimonial_2_role}}</div></div>
        </div>
      </div>
      <div class="testimonial-card">
        <div class="tc-stars">★★★★★</div>
        <p class="tc-quote">{{testimonial_3_quote}}</p>
        <div class="tc-author">
          <div class="tc-avatar">{{testimonial_3_initials}}</div>
          <div><div class="tc-name">{{testimonial_3_name}}</div><div class="tc-role">{{testimonial_3_role}}</div></div>
        </div>
      </div>
    </div>
  </section>

  <!-- PRICING -->
  <section class="pricing" id="pricing">
    <div class="section-label" style="text-align:center">{{pricing_label}}</div>
    <h2 class="section-title" style="margin:0 auto;text-align:center">{{pricing_title}}</h2>
    <div class="pricing-grid">
      <!-- Piano Free -->
      <div class="pricing-card">
        <div class="plan-name">{{plan_1_name}}</div>
        <div class="plan-price">{{plan_1_price}}</div>
        <div class="plan-period">{{plan_1_period}}</div>
        <ul class="plan-features">
          <li>{{plan_1_feature_1}}</li>
          <li>{{plan_1_feature_2}}</li>
          <li>{{plan_1_feature_3}}</li>
        </ul>
        <a href="{{signup_url}}" class="btn-plan">{{plan_1_cta}}</a>
      </div>
      <!-- Piano Pro (featured) -->
      <div class="pricing-card featured">
        <div class="pricing-badge">{{plan_2_badge}}</div>
        <div class="plan-name">{{plan_2_name}}</div>
        <div class="plan-price">{{plan_2_price}}</div>
        <div class="plan-period">{{plan_2_period}}</div>
        <ul class="plan-features">
          <li>{{plan_2_feature_1}}</li>
          <li>{{plan_2_feature_2}}</li>
          <li>{{plan_2_feature_3}}</li>
          <li>{{plan_2_feature_4}}</li>
        </ul>
        <a href="{{signup_url}}" class="btn-plan">{{plan_2_cta}}</a>
      </div>
      <!-- Piano Enterprise -->
      <div class="pricing-card">
        <div class="plan-name">{{plan_3_name}}</div>
        <div class="plan-price">{{plan_3_price}}</div>
        <div class="plan-period">{{plan_3_period}}</div>
        <ul class="plan-features">
          <li>{{plan_3_feature_1}}</li>
          <li>{{plan_3_feature_2}}</li>
          <li>{{plan_3_feature_3}}</li>
          <li>{{plan_3_feature_4}}</li>
        </ul>
        <a href="{{contact_url}}" class="btn-plan">{{plan_3_cta}}</a>
      </div>
    </div>
  </section>

  <!-- CTA FINALE -->
  <section class="cta-final">
    <h2>{{cta_title}}</h2>
    <p>{{cta_subtitle}}</p>
    <div class="cta-final-btns">
      <a href="{{signup_url}}" class="btn-hero">{{cta_primary}}</a>
      <a href="{{demo_url}}" class="btn-hero-outline">{{cta_secondary}}</a>
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
        <h4>{{footer_col_1_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col_1_link_1}}</a></li>
          <li><a href="#">{{footer_col_1_link_2}}</a></li>
          <li><a href="#">{{footer_col_1_link_3}}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>{{footer_col_2_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col_2_link_1}}</a></li>
          <li><a href="#">{{footer_col_2_link_2}}</a></li>
          <li><a href="#">{{footer_col_2_link_3}}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>{{footer_col_3_title}}</h4>
        <ul>
          <li><a href="#">{{footer_col_3_link_1}}</a></li>
          <li><a href="#">{{footer_col_3_link_2}}</a></li>
          <li><a href="#">{{footer_col_3_link_3}}</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>{{footer_copyright}}</span>
      <span>{{footer_links}}</span>
    </div>
  </footer>

</body>
</html>
`
