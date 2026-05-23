export type Component = {
  id: string
  name: string
  description: string
  category: 'form' | 'social-proof' | 'content' | 'utility'
  tags: string[]
  html: string
}

export const COMPONENT_REGISTRY: Component[] = [
  {
    id: 'logo-carousel',
    name: 'Logo Carousel',
    description: 'Striscia di loghi clienti/partner che scorre infinitamente',
    category: 'social-proof',
    tags: ['logo', 'carousel', 'loghi', 'partner', 'clienti', 'brand', 'scorre', 'infinite scroll', 'testimonial loghi'],
    html: `<section class="comp-lc-wrapper" style="overflow:hidden;padding:2rem 0;background:var(--color-bg,#ffffff);border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
  <style>
    .comp-lc-track{display:flex;gap:3rem;align-items:center;animation:comp-lc-scroll 35s linear infinite;width:max-content;}
    .comp-lc-wrapper:hover .comp-lc-track{animation-play-state:paused;}
    @keyframes comp-lc-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .comp-lc-logo{display:flex;align-items:center;justify-content:center;width:120px;height:52px;background:#f3f4f6;border-radius:var(--radius,10px);flex-shrink:0;}
    .comp-lc-logo span{font-size:0.8rem;font-weight:600;color:#9ca3af;font-family:var(--font-body,system-ui,sans-serif);}
  </style>
  <div style="display:flex;overflow:hidden;">
    <div class="comp-lc-track">
      <div class="comp-lc-logo"><span>Logo 1</span></div>
      <div class="comp-lc-logo"><span>Logo 2</span></div>
      <div class="comp-lc-logo"><span>Logo 3</span></div>
      <div class="comp-lc-logo"><span>Logo 4</span></div>
      <div class="comp-lc-logo"><span>Logo 5</span></div>
      <div class="comp-lc-logo"><span>Logo 6</span></div>
    </div>
    <div class="comp-lc-track" aria-hidden="true">
      <div class="comp-lc-logo"><span>Logo 1</span></div>
      <div class="comp-lc-logo"><span>Logo 2</span></div>
      <div class="comp-lc-logo"><span>Logo 3</span></div>
      <div class="comp-lc-logo"><span>Logo 4</span></div>
      <div class="comp-lc-logo"><span>Logo 5</span></div>
      <div class="comp-lc-logo"><span>Logo 6</span></div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'faq-accordion',
    name: 'FAQ Accordion',
    description: 'Sezione domande frequenti con risposte espandibili',
    category: 'content',
    tags: ['faq', 'accordion', 'domande', 'risposte', 'frequenti', 'questions', 'answers'],
    html: `<section class="comp-faq-section" style="max-width:720px;margin:3rem auto;padding:0 1.5rem;font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-faq-section h2{font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:1.5rem;text-align:center;}
    .comp-faq-item{border-bottom:1px solid #e5e7eb;}
    .comp-faq-question{width:100%;background:none;border:none;padding:1.1rem 0;display:flex;justify-content:space-between;align-items:center;font-size:1rem;font-weight:600;color:var(--color-text,#1a1a1a);cursor:pointer;font-family:inherit;text-align:left;gap:1rem;}
    .comp-faq-question:hover{color:var(--color-accent,#2563eb);}
    .comp-faq-icon{flex-shrink:0;font-size:1.25rem;transition:transform 0.25s;color:var(--color-accent,#2563eb);}
    .comp-faq-question[aria-expanded="true"] .comp-faq-icon{transform:rotate(45deg);}
    .comp-faq-answer{max-height:0;overflow:hidden;transition:max-height 0.3s ease;}
    .comp-faq-answer.open{max-height:500px;}
    .comp-faq-answer-inner{padding:0 0 1.1rem;font-size:0.95rem;line-height:1.7;color:#4b5563;}
  </style>
  <h2>Domande Frequenti</h2>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Qual è il tempo di risposta tipico?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Rispondiamo a tutte le richieste entro 24 ore lavorative. Per i clienti premium il tempo di risposta è garantito entro 4 ore.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Come posso cancellare il mio abbonamento?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Puoi cancellare in qualsiasi momento dal pannello di controllo, nella sezione "Abbonamento". Non ci sono penali né costi aggiuntivi.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Offrite una prova gratuita?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Sì, offriamo 14 giorni di prova gratuita senza inserire la carta di credito. Puoi esplorare tutte le funzionalità senza impegno.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>I miei dati sono al sicuro?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Assolutamente sì. Utilizziamo crittografia AES-256 per tutti i dati a riposo e TLS 1.3 per i dati in transito. Siamo conformi al GDPR.</div>
    </div>
  </div>
  <div class="comp-faq-item">
    <button class="comp-faq-question" aria-expanded="false">
      <span>Posso integrare strumenti di terze parti?</span>
      <span class="comp-faq-icon">+</span>
    </button>
    <div class="comp-faq-answer" role="region">
      <div class="comp-faq-answer-inner">Sì, supportiamo oltre 50 integrazioni tra cui Slack, Google Analytics, HubSpot, Zapier e molti altri. Le integrazioni personalizzate sono disponibili nei piani Business e Enterprise.</div>
    </div>
  </div>
  <script>
    (function(){
      document.querySelectorAll('.comp-faq-question').forEach(function(btn){
        btn.addEventListener('click',function(){
          var expanded=this.getAttribute('aria-expanded')==='true';
          this.setAttribute('aria-expanded',expanded?'false':'true');
          var answer=this.nextElementSibling;
          if(answer){answer.classList.toggle('open',!expanded);}
        });
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'contact-form',
    name: 'Form di Contatto',
    description: 'Form con nome, email, messaggio e validazione client-side',
    category: 'form',
    tags: ['form', 'contatto', 'contact', 'email', 'messaggio', 'modulo', 'formulario'],
    html: `<section class="comp-cf-section" style="max-width:560px;margin:3rem auto;padding:0 1.5rem;font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-cf-section h2{font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-cf-section p.comp-cf-sub{color:#6b7280;margin-bottom:2rem;font-size:0.95rem;}
    .comp-cf-group{margin-bottom:1.2rem;}
    .comp-cf-label{display:block;font-size:0.875rem;font-weight:600;color:var(--color-text,#1a1a1a);margin-bottom:0.4rem;}
    .comp-cf-input,.comp-cf-textarea{width:100%;box-sizing:border-box;padding:0.65rem 0.9rem;border:1.5px solid #d1d5db;border-radius:var(--radius,10px);font-size:0.95rem;font-family:inherit;color:var(--color-text,#1a1a1a);background:#fff;transition:border-color 0.15s;outline:none;}
    .comp-cf-input:focus,.comp-cf-textarea:focus{border-color:var(--color-accent,#2563eb);}
    .comp-cf-textarea{resize:vertical;min-height:120px;}
    .comp-cf-error{display:none;color:#ef4444;font-size:0.78rem;margin-top:0.3rem;}
    .comp-cf-btn{width:100%;padding:0.75rem;background:var(--color-accent,#2563eb);color:#fff;border:none;border-radius:var(--radius,10px);font-size:1rem;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity 0.15s;}
    .comp-cf-btn:hover{opacity:0.88;}
    .comp-cf-btn:disabled{opacity:0.55;cursor:not-allowed;}
    .comp-cf-status{margin-top:1rem;padding:0.75rem 1rem;border-radius:var(--radius,10px);font-size:0.9rem;display:none;}
    .comp-cf-status.success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;display:block;}
    .comp-cf-status.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;display:block;}
  </style>
  <h2>Contattaci</h2>
  <p class="comp-cf-sub">Compila il modulo e ti risponderemo entro 24 ore.</p>
  <form class="comp-cf-form" novalidate>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-name">Nome *</label>
      <input class="comp-cf-input" type="text" id="comp-cf-name" name="name" placeholder="Il tuo nome" autocomplete="name">
      <span class="comp-cf-error" id="comp-cf-name-err">Inserisci il tuo nome.</span>
    </div>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-email">Email *</label>
      <input class="comp-cf-input" type="email" id="comp-cf-email" name="email" placeholder="tua@email.com" autocomplete="email">
      <span class="comp-cf-error" id="comp-cf-email-err">Inserisci un'email valida.</span>
    </div>
    <div class="comp-cf-group">
      <label class="comp-cf-label" for="comp-cf-msg">Messaggio *</label>
      <textarea class="comp-cf-textarea" id="comp-cf-msg" name="message" placeholder="Come possiamo aiutarti?"></textarea>
      <span class="comp-cf-error" id="comp-cf-msg-err">Scrivi un messaggio.</span>
    </div>
    <button class="comp-cf-btn" type="submit">Invia messaggio</button>
    <div class="comp-cf-status" id="comp-cf-status"></div>
  </form>
  <script>
    (function(){
      var form=document.querySelector('.comp-cf-form');
      if(!form)return;
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var name=document.getElementById('comp-cf-name');
        var email=document.getElementById('comp-cf-email');
        var msg=document.getElementById('comp-cf-msg');
        var nameErr=document.getElementById('comp-cf-name-err');
        var emailErr=document.getElementById('comp-cf-email-err');
        var msgErr=document.getElementById('comp-cf-msg-err');
        var status=document.getElementById('comp-cf-status');
        var valid=true;
        nameErr.style.display='none'; emailErr.style.display='none'; msgErr.style.display='none';
        status.className='comp-cf-status'; status.textContent='';
        if(!name.value.trim()){nameErr.style.display='block';valid=false;}
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)){emailErr.style.display='block';valid=false;}
        if(!msg.value.trim()){msgErr.style.display='block';valid=false;}
        if(!valid)return;
        var btn=form.querySelector('.comp-cf-btn');
        btn.disabled=true; btn.textContent='Invio in corso…';
        fetch('/api/forms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value,email:email.value,message:msg.value})})
          .then(function(r){return r.ok?r.json():Promise.reject(r.status);})
          .then(function(){status.className='comp-cf-status success';status.textContent='Messaggio inviato! Ti risponderemo presto.';form.reset();})
          .catch(function(){status.className='comp-cf-status error';status.textContent='Errore nell\'invio. Riprova più tardi.';})
          .finally(function(){btn.disabled=false;btn.textContent='Invia messaggio';});
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'newsletter-form',
    name: 'Form Newsletter',
    description: 'Iscrizione newsletter con campo email e CTA',
    category: 'form',
    tags: ['newsletter', 'email', 'iscrizione', 'subscribe', 'mailinglist', 'mailing list'],
    html: `<section class="comp-nf-section" style="padding:3rem 1.5rem;background:var(--color-bg,#f8fafc);font-family:var(--font-body,system-ui,sans-serif);">
  <style>
    .comp-nf-inner{max-width:520px;margin:0 auto;text-align:center;}
    .comp-nf-inner h2{font-size:1.6rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-nf-inner p{color:#6b7280;margin-bottom:1.5rem;font-size:0.95rem;}
    .comp-nf-row{display:flex;gap:0.6rem;flex-wrap:wrap;}
    .comp-nf-input{flex:1;min-width:200px;padding:0.7rem 1rem;border:1.5px solid #d1d5db;border-radius:var(--radius,10px);font-size:0.95rem;font-family:inherit;outline:none;transition:border-color 0.15s;}
    .comp-nf-input:focus{border-color:var(--color-accent,#2563eb);}
    .comp-nf-btn{padding:0.7rem 1.4rem;background:var(--color-accent,#2563eb);color:#fff;border:none;border-radius:var(--radius,10px);font-weight:600;font-size:0.95rem;cursor:pointer;font-family:inherit;white-space:nowrap;transition:opacity 0.15s;}
    .comp-nf-btn:hover{opacity:0.88;}
    .comp-nf-btn:disabled{opacity:0.55;cursor:not-allowed;}
    .comp-nf-privacy{margin-top:0.75rem;font-size:0.75rem;color:#9ca3af;}
    .comp-nf-status{margin-top:0.75rem;font-size:0.88rem;padding:0.6rem 0.9rem;border-radius:8px;display:none;}
    .comp-nf-status.ok{background:#ecfdf5;color:#065f46;display:block;}
    .comp-nf-status.err{background:#fef2f2;color:#991b1b;display:block;}
  </style>
  <div class="comp-nf-inner">
    <h2>Resta aggiornato</h2>
    <p>Iscriviti alla newsletter e ricevi novità, risorse e offerte esclusive.</p>
    <form class="comp-nf-form" novalidate>
      <div class="comp-nf-row">
        <input class="comp-nf-input" type="email" name="email" placeholder="tua@email.com" autocomplete="email" required>
        <button class="comp-nf-btn" type="submit">Iscriviti</button>
      </div>
      <div class="comp-nf-privacy">Nessuno spam. Cancellati in qualsiasi momento. 🔒</div>
      <div class="comp-nf-status" id="comp-nf-status"></div>
    </form>
  </div>
  <script>
    (function(){
      var form=document.querySelector('.comp-nf-form');
      if(!form)return;
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var email=form.querySelector('input[type=email]');
        var btn=form.querySelector('.comp-nf-btn');
        var status=document.getElementById('comp-nf-status');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)){status.className='comp-nf-status err';status.textContent='Inserisci un\'email valida.';return;}
        btn.disabled=true;btn.textContent='…';status.className='comp-nf-status';status.textContent='';
        fetch('/api/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value})})
          .then(function(r){return r.ok?r.json():Promise.reject();})
          .then(function(){status.className='comp-nf-status ok';status.textContent='Iscrizione avvenuta! Grazie.';email.value='';})
          .catch(function(){status.className='comp-nf-status err';status.textContent='Errore. Riprova più tardi.';})
          .finally(function(){btn.disabled=false;btn.textContent='Iscriviti';});
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'cookie-banner',
    name: 'Cookie Banner GDPR',
    description: 'Banner consenso cookie con accetta/rifiuta, persistente in localStorage',
    category: 'utility',
    tags: ['cookie', 'gdpr', 'banner', 'consenso', 'privacy', 'cookies'],
    html: `<div class="comp-ck-banner" id="comp-ck-banner" role="dialog" aria-label="Cookie consent" style="display:none;">
  <style>
    .comp-ck-banner{position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--color-bg,#ffffff);border-top:1px solid #e5e7eb;padding:1rem 1.5rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;font-family:var(--font-body,system-ui,sans-serif);box-shadow:0 -2px 12px rgba(0,0,0,0.08);}
    .comp-ck-text{flex:1;min-width:240px;font-size:0.88rem;color:var(--color-text,#1a1a1a);line-height:1.5;}
    .comp-ck-text a{color:var(--color-accent,#2563eb);text-decoration:underline;}
    .comp-ck-actions{display:flex;gap:0.6rem;flex-shrink:0;}
    .comp-ck-btn{padding:0.55rem 1.1rem;border-radius:var(--radius,10px);font-size:0.85rem;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:opacity 0.15s;}
    .comp-ck-btn:hover{opacity:0.85;}
    .comp-ck-accept{background:var(--color-accent,#2563eb);color:#fff;}
    .comp-ck-reject{background:transparent;color:var(--color-text,#1a1a1a);border:1.5px solid #d1d5db !important;}
  </style>
  <div class="comp-ck-text">
    Utilizziamo i cookie per migliorare la tua esperienza e analizzare il traffico. Leggi la nostra <a href="#">Privacy Policy</a>.
  </div>
  <div class="comp-ck-actions">
    <button class="comp-ck-btn comp-ck-reject" id="comp-ck-reject">Solo necessari</button>
    <button class="comp-ck-btn comp-ck-accept" id="comp-ck-accept">Accetta tutti</button>
  </div>
  <script>
    (function(){
      var banner=document.getElementById('comp-ck-banner');
      if(!banner)return;
      if(!localStorage.getItem('cookie-consent')){banner.style.display='flex';}
      function dismiss(val){localStorage.setItem('cookie-consent',val);banner.style.display='none';}
      document.getElementById('comp-ck-accept').addEventListener('click',function(){dismiss('all');});
      document.getElementById('comp-ck-reject').addEventListener('click',function(){dismiss('necessary');});
    })();
  </script>
</div>`,
  },
  {
    id: 'pricing-toggle',
    name: 'Pricing Toggle',
    description: 'Switch mensile/annuale con risparmio evidenziato e 3 piani',
    category: 'content',
    tags: ['pricing', 'prezzi', 'toggle', 'piano', 'mensile', 'annuale', 'abbonamento', 'piani'],
    html: `<section class="comp-pt-section" style="padding:3rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);">
  <style>
    .comp-pt-section h2{text-align:center;font-size:1.75rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:0.5rem;}
    .comp-pt-sub{text-align:center;color:#6b7280;margin-bottom:1.75rem;font-size:0.95rem;}
    .comp-pt-toggle-row{display:flex;align-items:center;justify-content:center;gap:0.75rem;margin-bottom:2rem;}
    .comp-pt-toggle-label{font-size:0.9rem;font-weight:600;color:#6b7280;}
    .comp-pt-toggle-label.active{color:var(--color-text,#1a1a1a);}
    .comp-pt-switch{position:relative;display:inline-block;width:48px;height:26px;}
    .comp-pt-switch input{opacity:0;width:0;height:0;}
    .comp-pt-slider{position:absolute;cursor:pointer;inset:0;background:#d1d5db;border-radius:26px;transition:0.2s;}
    .comp-pt-slider::before{content:'';position:absolute;height:20px;width:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:0.2s;}
    input:checked+.comp-pt-slider{background:var(--color-accent,#2563eb);}
    input:checked+.comp-pt-slider::before{transform:translateX(22px);}
    .comp-pt-badge{background:#ecfdf5;color:#065f46;font-size:0.75rem;font-weight:700;padding:2px 8px;border-radius:99px;}
    .comp-pt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.25rem;max-width:900px;margin:0 auto;}
    .comp-pt-card{border:1.5px solid #e5e7eb;border-radius:var(--radius,10px);padding:1.75rem;display:flex;flex-direction:column;gap:0.75rem;transition:box-shadow 0.2s;}
    .comp-pt-card.featured{border-color:var(--color-accent,#2563eb);box-shadow:0 4px 24px rgba(37,99,235,0.12);}
    .comp-pt-plan{font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-accent,#2563eb);}
    .comp-pt-price{font-size:2.25rem;font-weight:800;color:var(--color-text,#1a1a1a);line-height:1;}
    .comp-pt-price span{font-size:1rem;font-weight:500;color:#6b7280;}
    .comp-pt-desc{font-size:0.88rem;color:#6b7280;line-height:1.5;}
    .comp-pt-divider{border:none;border-top:1px solid #e5e7eb;margin:0.25rem 0;}
    .comp-pt-features{list-style:none;margin:0;padding:0;font-size:0.88rem;color:var(--color-text,#1a1a1a);display:flex;flex-direction:column;gap:0.5rem;}
    .comp-pt-features li::before{content:'✓ ';color:var(--color-accent,#2563eb);font-weight:700;}
    .comp-pt-cta{margin-top:auto;padding:0.7rem;border-radius:var(--radius,10px);font-weight:600;font-size:0.95rem;cursor:pointer;border:none;font-family:inherit;transition:opacity 0.15s;text-align:center;text-decoration:none;display:block;}
    .comp-pt-cta.primary{background:var(--color-accent,#2563eb);color:#fff;}
    .comp-pt-cta.secondary{background:transparent;color:var(--color-accent,#2563eb);border:1.5px solid var(--color-accent,#2563eb);}
    .comp-pt-cta:hover{opacity:0.85;}
  </style>
  <h2>Scegli il tuo piano</h2>
  <p class="comp-pt-sub">Prova gratuita 14 giorni. Nessuna carta di credito richiesta.</p>
  <div class="comp-pt-toggle-row">
    <span class="comp-pt-toggle-label active" id="comp-pt-lbl-m">Mensile</span>
    <label class="comp-pt-switch">
      <input type="checkbox" id="comp-pt-toggle">
      <span class="comp-pt-slider"></span>
    </label>
    <span class="comp-pt-toggle-label" id="comp-pt-lbl-a">Annuale <span class="comp-pt-badge">Risparmia 20%</span></span>
  </div>
  <div class="comp-pt-grid">
    <div class="comp-pt-card">
      <div class="comp-pt-plan">Basic</div>
      <div class="comp-pt-price"><span data-m="9" data-a="7">9</span><span>/mo</span></div>
      <p class="comp-pt-desc">Perfetto per freelancer e piccoli progetti.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>1 sito web</li>
        <li>5 GB storage</li>
        <li>Supporto email</li>
      </ul>
      <a href="#" class="comp-pt-cta secondary">Inizia gratis</a>
    </div>
    <div class="comp-pt-card featured">
      <div class="comp-pt-plan">Pro ⭐</div>
      <div class="comp-pt-price"><span data-m="29" data-a="23">29</span><span>/mo</span></div>
      <p class="comp-pt-desc">Ideale per team in crescita e agenzie.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>10 siti web</li>
        <li>50 GB storage</li>
        <li>Supporto prioritario</li>
        <li>Analytics avanzati</li>
      </ul>
      <a href="#" class="comp-pt-cta primary">Inizia gratis</a>
    </div>
    <div class="comp-pt-card">
      <div class="comp-pt-plan">Enterprise</div>
      <div class="comp-pt-price"><span data-m="79" data-a="63">79</span><span>/mo</span></div>
      <p class="comp-pt-desc">Per grandi team e aziende enterprise.</p>
      <hr class="comp-pt-divider">
      <ul class="comp-pt-features">
        <li>Siti illimitati</li>
        <li>Storage illimitato</li>
        <li>Supporto 24/7</li>
        <li>SLA garantito</li>
      </ul>
      <a href="#" class="comp-pt-cta secondary">Contattaci</a>
    </div>
  </div>
  <script>
    (function(){
      var toggle=document.getElementById('comp-pt-toggle');
      var lblM=document.getElementById('comp-pt-lbl-m');
      var lblA=document.getElementById('comp-pt-lbl-a');
      if(!toggle)return;
      toggle.addEventListener('change',function(){
        var annual=this.checked;
        lblM.classList.toggle('active',!annual);
        lblA.classList.toggle('active',annual);
        document.querySelectorAll('.comp-pt-price [data-m]').forEach(function(el){
          el.textContent=annual?el.getAttribute('data-a'):el.getAttribute('data-m');
        });
      });
    })();
  </script>
</section>`,
  },
  {
    id: 'data-table',
    name: 'Tabella Dati',
    description: 'Tabella personalizzabile con intestazioni e righe dati, responsive',
    category: 'content',
    tags: ['tabella', 'table', 'dati', 'righe', 'colonne', 'grid', 'confronto'],
    html: `<section class="comp-dt-section" style="padding:2rem 1.5rem;font-family:var(--font-body,system-ui,sans-serif);background:var(--color-bg,#ffffff);">
  <style>
    .comp-dt-section h2{font-size:1.5rem;font-weight:700;color:var(--color-text,#1a1a1a);margin-bottom:1.25rem;}
    .comp-dt-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;}
    .comp-dt-table{width:100%;border-collapse:collapse;min-width:480px;font-size:0.9rem;}
    .comp-dt-table thead{position:sticky;top:0;z-index:1;}
    .comp-dt-table th{background:var(--color-accent,#2563eb);color:#fff;padding:0.75rem 1rem;text-align:left;font-weight:600;white-space:nowrap;}
    .comp-dt-table th:first-child{border-radius:var(--radius,10px) 0 0 0;}
    .comp-dt-table th:last-child{border-radius:0 var(--radius,10px) 0 0;}
    .comp-dt-table td{padding:0.7rem 1rem;border-bottom:1px solid #e5e7eb;color:var(--color-text,#1a1a1a);}
    .comp-dt-table tbody tr:nth-child(even){background:#f8fafc;}
    .comp-dt-table tbody tr:hover{background:#eff6ff;}
    .comp-dt-table tbody tr:last-child td{border-bottom:none;}
    .comp-dt-table tbody tr:last-child td:first-child{border-radius:0 0 0 var(--radius,10px);}
    .comp-dt-table tbody tr:last-child td:last-child{border-radius:0 0 var(--radius,10px) 0;}
  </style>
  <h2>Tabella Dati</h2>
  <div class="comp-dt-scroll">
    <table class="comp-dt-table">
      <thead>
        <tr>
          <th>Prodotto</th>
          <th>Categoria</th>
          <th>Prezzo</th>
          <th>Disponibilità</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Prodotto Alpha</td><td>Categoria A</td><td>€ 49,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Beta</td><td>Categoria B</td><td>€ 99,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Gamma</td><td>Categoria A</td><td>€ 149,00</td><td>⚠️ Limitato</td></tr>
        <tr><td>Prodotto Delta</td><td>Categoria C</td><td>€ 29,00</td><td>✅ Disponibile</td></tr>
        <tr><td>Prodotto Epsilon</td><td>Categoria B</td><td>€ 199,00</td><td>❌ Esaurito</td></tr>
      </tbody>
    </table>
  </div>
</section>`,
  },
]

export function findComponentByKeywords(text: string): Component | null {
  const lower = text.toLowerCase()
  return COMPONENT_REGISTRY.find(c =>
    c.tags.some(tag => lower.includes(tag)) || lower.includes(c.id)
  ) ?? null
}
