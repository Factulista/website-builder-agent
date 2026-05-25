/**
 * Blog Editor Test Runner
 * Estrae il vero inline edit script da page.tsx, genera un test HTML
 * con 16 test case e lo apre in browser.
 *
 * Run: node scripts/test-blog-editor.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── 1. Estrai l'inline edit script da page.tsx ────────────────────────────────
const pageSrc = readFileSync(resolve(root, 'app/projects/[id]/page.tsx'), 'utf-8')

// Il template literal inizia con `(function(){` e finisce con `})();`
// Dentro buildInlineEditScriptTemplate — lo estraiamo con delimitatori precisi
const startMarker = "return `(function(){"
const endMarker   = "})();\`\n} // end buildInlineEditScriptTemplate"

const startIdx = pageSrc.indexOf(startMarker)
const endIdx   = pageSrc.indexOf(endMarker)

if (startIdx === -1 || endIdx === -1) {
  console.error('❌ Non riesco a trovare buildInlineEditScriptTemplate in page.tsx')
  console.error('   Verifica che i delimitatori siano ancora gli stessi.')
  process.exit(1)
}

// Estrai il corpo del template literal (senza il backtick di apertura/chiusura)
const rawScript = pageSrc.slice(startIdx + startMarker.length, endIdx + '})();'.length)

// Il template usa ${pagesJson} — lo rimpiazziamo con un array vuoto per i test
const INLINE_EDIT_SCRIPT = `(function(){\n  var FACT_PAGES=[];` + rawScript.replace(/\$\{pagesJson\}/g, '[]')

console.log(`✅ Inline edit script estratto — ${INLINE_EDIT_SCRIPT.length} chars`)

// ── 2. Genera l'HTML di test ──────────────────────────────────────────────────
const html = generateTestHtml(INLINE_EDIT_SCRIPT)

const outPath = resolve(root, 'scripts/_blog-editor-test.html')
writeFileSync(outPath, html, 'utf-8')
console.log(`✅ Test HTML generato: ${outPath}`)

// ── 3. Apri in browser ────────────────────────────────────────────────────────
const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
try {
  execSync(`${openCmd} "${outPath}"`)
  console.log('🌐 Aperto in browser — attendi qualche secondo per i risultati.')
} catch {
  console.log(`ℹ️  Apri manualmente: file://${outPath}`)
}

// ── Helper ────────────────────────────────────────────────────────────────────
function generateTestHtml(inlineEditScript) {
  // Contenuto del blog usato come fixture
  const BLOG_FIXTURE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; padding: 40px; max-width: 720px; margin: 0 auto; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 2.2rem; font-weight: 700; margin: 0 0 1rem; }
  h2 { font-size: 1.6rem; font-weight: 700; margin: 1.5rem 0 0.5rem; }
  p  { margin: 0 0 1rem; }
</style>
</head>
<body>
  <h1 id="title">Titolo dell'articolo di test</h1>
  <p id="intro">Questo è il paragrafo di introduzione con del testo selezionabile per i test automatici.</p>
  <h2 id="subtitle">Sottotitolo di sezione</h2>
  <p id="body1">Paragrafo del corpo del testo che verrà usato per testare grassetto, corsivo, sottolineato e barrato.</p>
  <p id="body2">Secondo paragrafo usato per testare allineamento e colore del testo.</p>
  <p id="body3">Terzo paragrafo per testare i cambi di tipo blocco (H1, H2, H3, P, BLOCKQUOTE).</p>
  <p id="insertTarget">Paragrafo per testare insertHTML e liste.</p>
  <table id="testTable" style="border-collapse:collapse;width:100%;margin:1rem 0;">
    <thead><tr><th style="border:1px solid #ccc;padding:8px;">Colonna A</th><th style="border:1px solid #ccc;padding:8px;">Colonna B</th></tr></thead>
    <tbody><tr><td style="border:1px solid #ccc;padding:8px;">Cella 1</td><td style="border:1px solid #ccc;padding:8px;">Cella 2</td></tr></tbody>
  </table>
</body>
</html>`

  // Escape per metterlo in un JS string literal
  const fixtureEscaped = JSON.stringify(BLOG_FIXTURE)

  return /* html */`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blog Editor — Test Suite</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f8fafc; color: #1a1a1a; min-height: 100vh; }
    header { background: #1e293b; color: #fff; padding: 18px 28px; display: flex; align-items: center; gap: 14px; }
    header h1 { font-size: 1.2rem; font-weight: 700; }
    header p  { font-size: 0.8rem; opacity: 0.6; }
    #summary { padding: 14px 28px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
    #summary span { font-size: 0.88rem; font-weight: 600; }
    .s-pass  { color: #16a34a; }
    .s-fail  { color: #dc2626; }
    .s-skip  { color: #9ca3af; }
    .s-run   { color: #2563eb; }
    main { display: grid; grid-template-columns: 1fr 380px; gap: 0; height: calc(100vh - 108px); }
    #results { overflow-y: auto; padding: 20px 28px; display: flex; flex-direction: column; gap: 8px; }
    #iframe-col { border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; }
    #iframe-col h2 { padding: 10px 16px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; border-bottom: 1px solid #e2e8f0; }
    iframe { flex: 1; border: none; width: 100%; }
    .test-card { border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; overflow: hidden; }
    .test-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; }
    .test-status { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; flex-shrink: 0; }
    .status-pass    { background: #dcfce7; color: #16a34a; }
    .status-fail    { background: #fee2e2; color: #dc2626; }
    .status-running { background: #dbeafe; color: #2563eb; }
    .status-pending { background: #f1f5f9; color: #94a3b8; }
    .test-name { font-size: 0.88rem; font-weight: 600; flex: 1; }
    .test-time { font-size: 0.73rem; color: #9ca3af; }
    .test-detail { padding: 0 14px 12px; font-size: 0.78rem; color: #6b7280; display: none; border-top: 1px solid #f1f5f9; padding-top: 8px; line-height: 1.6; }
    .test-detail.open { display: block; }
    .test-detail code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; color: #1e40af; }
    .test-detail .err { color: #dc2626; font-weight: 600; }
    .test-detail .ok  { color: #16a34a; font-weight: 600; }
    h3.group { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; padding: 8px 0 4px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🧪 Blog Editor — Test Suite</h1>
      <p>Verifica automatica di tutti i comandi della toolbar e del bridge postMessage</p>
    </div>
  </header>

  <div id="summary">
    <span class="s-run" id="s-total">⏳ Inizializzazione…</span>
    <span class="s-pass" id="s-pass" style="display:none">✅ <span id="s-pass-n">0</span> passati</span>
    <span class="s-fail" id="s-fail" style="display:none">❌ <span id="s-fail-n">0</span> falliti</span>
  </div>

  <main>
    <div id="results"><!-- cards inserite via JS --></div>
    <div id="iframe-col">
      <h2>Iframe editor</h2>
      <iframe id="editor-iframe" sandbox="allow-scripts allow-same-origin" title="Blog Editor"></iframe>
    </div>
  </main>

<script>
// ── Inline Edit Script (estratto da buildInlineEditScriptTemplate) ─────────────
const INLINE_EDIT_SCRIPT = ${JSON.stringify(inlineEditScript)};

const BLOG_FIXTURE = ${fixtureEscaped};

// ── Test runner state ─────────────────────────────────────────────────────────
let passCount = 0, failCount = 0
const iframe = document.getElementById('editor-iframe')

// ── Utilities ─────────────────────────────────────────────────────────────────
function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

/** Ricarica l'iframe con contenuto fresco + inline edit script */
function reloadIframe() {
  return new Promise(resolve => {
    const doc = BLOG_FIXTURE + \`<script id="fact-edit-script">\${INLINE_EDIT_SCRIPT}<\\/script>\`
    iframe.srcdoc = doc
    iframe.onload = () => { setTimeout(resolve, 120) } // lascia tempo allo script di init
  })
}

/** Seleziona tutto il testo di un elemento nell'iframe tramite contentWindow */
function selectElementText(selector) {
  const iwin  = iframe.contentWindow
  const idoc  = iframe.contentDocument
  const el    = idoc.querySelector(selector)
  if (!el) return false
  // Trova il primo testo editabile (potrebbe essere avvolto da contenteditable parent)
  const editable = el.closest('[contenteditable]') || el
  editable.focus()
  const range = idoc.createRange()
  range.selectNodeContents(el)
  const sel = iwin.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

/** Invia un comando postMessage all'iframe */
function sendFormat(cmd, val) {
  iframe.contentWindow.postMessage({ type: 'fact-format', cmd, val }, '*')
}

/** Attende il prossimo messaggio html-change dall'iframe (con timeout) */
function waitForHtmlChange(timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('timeout: nessun html-change ricevuto'))
    }, timeoutMs)
    function handler(e) {
      if (e.data?.type === 'html-change') {
        clearTimeout(t)
        window.removeEventListener('message', handler)
        resolve(e.data.html)
      }
    }
    window.addEventListener('message', handler)
  })
}

/** Attende il prossimo messaggio fact-block dall'iframe */
function waitForBlockReport(timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('timeout: nessun fact-block ricevuto'))
    }, timeoutMs)
    function handler(e) {
      if (e.data?.type === 'fact-block') {
        clearTimeout(t)
        window.removeEventListener('message', handler)
        resolve(e.data.tag)
      }
    }
    window.addEventListener('message', handler)
  })
}

// ── UI helpers ────────────────────────────────────────────────────────────────
const resultsEl = document.getElementById('results')
const cards = {}

function addGroup(label) {
  const h = document.createElement('h3')
  h.className = 'group'
  h.textContent = label
  resultsEl.appendChild(h)
}

function addCard(id, name) {
  const card = document.createElement('div')
  card.className = 'test-card'
  card.id = 'card-' + id
  card.innerHTML = \`
    <div class="test-header" onclick="toggleDetail('\${id}')">
      <div class="test-status status-pending" id="status-\${id}">·</div>
      <span class="test-name">\${name}</span>
      <span class="test-time" id="time-\${id}"></span>
    </div>
    <div class="test-detail" id="detail-\${id}"></div>\`
  resultsEl.appendChild(card)
  cards[id] = card
}

function toggleDetail(id) {
  const d = document.getElementById('detail-' + id)
  d.classList.toggle('open')
}

function setRunning(id) {
  const s = document.getElementById('status-' + id)
  s.className = 'test-status status-running'
  s.textContent = '…'
}

function setResult(id, passed, detail, ms) {
  const s = document.getElementById('status-' + id)
  const t = document.getElementById('time-' + id)
  s.className = 'test-status ' + (passed ? 'status-pass' : 'status-fail')
  s.textContent = passed ? '✓' : '✗'
  if (ms !== undefined) t.textContent = ms + 'ms'
  const d = document.getElementById('detail-' + id)
  d.innerHTML = detail
  if (!passed) d.classList.add('open')
  if (passed) passCount++; else failCount++
}

function updateSummary(running) {
  const tot = document.getElementById('s-total')
  if (running) {
    tot.textContent = '⏳ Esecuzione test in corso…'
  } else {
    const all = passCount + failCount
    tot.textContent = \`\${all} test eseguiti\`
    document.getElementById('s-pass').style.display = ''
    document.getElementById('s-fail').style.display = ''
    document.getElementById('s-pass-n').textContent = passCount
    document.getElementById('s-fail-n').textContent = failCount
  }
}

// ── Helper per eseguire un test ───────────────────────────────────────────────
async function runTest(id, fn) {
  setRunning(id)
  const t0 = Date.now()
  try {
    const detail = await fn()
    setResult(id, true, detail || '<span class="ok">✓ Verifica superata</span>', Date.now() - t0)
  } catch (err) {
    setResult(id, false, \`<span class="err">✗ \${err.message}</span>\`, Date.now() - t0)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function assertHtmlContains(html, pattern, label) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i')
  if (!re.test(html)) throw new Error(\`\${label}: non trovato in html — pattern: \${pattern}\`)
}

// ── Definizione test ──────────────────────────────────────────────────────────
function defineTests() {

  // ── Gruppo: Selezione & Bridge ────────────────────────────────────────────
  addGroup('Selezione & Bridge postMessage')

  addCard('html-change', 'html-change inviato dopo ogni modifica')
  addCard('fact-save-sel', 'fact-save-sel salva e ripristina la selezione')
  addCard('fact-block-p', 'fact-block riporta P per paragrafo attivo')
  addCard('fact-block-h1', 'fact-block riporta H1 per titolo attivo')

  // ── Gruppo: Formattazione inline ──────────────────────────────────────────
  addGroup('Formattazione inline')

  addCard('bold',          'bold — applica <strong> / <b>')
  addCard('italic',        'italic — applica <em> / <i>')
  addCard('underline',     'underline — applica sottolineato')
  addCard('strikethrough', 'strikeThrough — applica barrato')
  addCard('fontname',      'fontName — cambia font con styleWithCSS')
  addCard('forecolor',     'foreColor — cambia colore testo')

  // ── Gruppo: Tipo di blocco ────────────────────────────────────────────────
  addGroup('Tipo di blocco (formatBlock)')

  addCard('fmt-h1',        'formatBlock h1 — converte paragrafo in H1')
  addCard('fmt-h2',        'formatBlock h2 — converte paragrafo in H2')
  addCard('fmt-h3',        'formatBlock h3 — converte paragrafo in H3')
  addCard('fmt-p',         'formatBlock p  — riconverte in paragrafo')
  addCard('fmt-blockquote','formatBlock blockquote — converte in citazione')

  // ── Gruppo: Insert & Allineamento ─────────────────────────────────────────
  addGroup('Insert & Allineamento')

  addCard('insert-html',   'insertHTML — inserisce HTML arbitrario')
  addCard('justify-center','justifyCenter — centra il testo')
  addCard('insert-ol',     'insertOrderedList — inserisce lista ordinata')
  addCard('insert-ul',     'insertUnorderedList — inserisce lista puntata')
}

// ── Esecuzione test ───────────────────────────────────────────────────────────
async function runAll() {
  defineTests()
  updateSummary(true)

  await reloadIframe()

  // ── fact-block per P ─────────────────────────────────────────────────────
  await runTest('fact-block-p', async () => {
    await reloadIframe()
    const blockPromise = waitForBlockReport()
    selectElementText('#intro')
    // dispatch selectionchange
    iframe.contentDocument.dispatchEvent(new Event('selectionchange'))
    const tag = await blockPromise
    assert(tag === 'P', \`Atteso P, ricevuto \${tag}\`)
    return \`<span class="ok">Riportato tag: <code>\${tag}</code></span>\`
  })

  // ── fact-block per H1 ────────────────────────────────────────────────────
  await runTest('fact-block-h1', async () => {
    await reloadIframe()
    const blockPromise = waitForBlockReport()
    selectElementText('#title')
    iframe.contentDocument.dispatchEvent(new Event('selectionchange'))
    const tag = await blockPromise
    assert(tag === 'H1', \`Atteso H1, ricevuto \${tag}\`)
    return \`<span class="ok">Riportato tag: <code>\${tag}</code></span>\`
  })

  // ── html-change ──────────────────────────────────────────────────────────
  await runTest('html-change', async () => {
    await reloadIframe()
    const changePromise = waitForHtmlChange()
    // Modifica diretta nell'iframe (simula input)
    const el = iframe.contentDocument.querySelector('#intro')
    el.focus()
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const html = await changePromise
    assert(typeof html === 'string' && html.includes('<!DOCTYPE'), 'html-change non contiene HTML valido')
    assert(!html.includes('contenteditable'), 'html-change contiene attributi editor non ripuliti')
    assert(!html.includes('data-fact-edit'), 'html-change contiene data-fact-edit non ripulito')
    return \`<span class="ok">html-change ricevuto — \${html.length} chars, senza artefatti editor</span>\`
  })

  // ── fact-save-sel ────────────────────────────────────────────────────────
  await runTest('fact-save-sel', async () => {
    await reloadIframe()
    // Seleziona testo
    selectElementText('#body1')
    const selBefore = iframe.contentWindow.getSelection()
    const textBefore = selBefore.toString()
    assert(textBefore.length > 0, 'Nessun testo selezionato prima di fact-save-sel')

    // Invia fact-save-sel
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(80)

    // Cancella selezione simulando click su elemento non-editable
    iframe.contentWindow.getSelection().removeAllRanges()
    await wait(50)
    assert(iframe.contentWindow.getSelection().toString() === '', 'Selezione non cancellata')

    // Manda un formato che triggera il ripristino della selezione
    const changePromise = waitForHtmlChange()
    sendFormat('bold')
    const html = await changePromise
    // Se la selezione è stata ripristinata, il bold avrà avvolto il testo in <b>/<strong>
    assert(/<b>|<strong>/i.test(html), 'bold non applicato — la selezione NON è stata ripristinata')
    return \`<span class="ok">Selezione salvata e ripristinata correttamente prima del comando</span>\`
  })

  // ── bold ─────────────────────────────────────────────────────────────────
  await runTest('bold', async () => {
    await reloadIframe()
    selectElementText('#body1')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('bold')
    const html = await changePromise
    assertHtmlContains(html, /<b>|<strong>/i, 'bold')
    return \`<span class="ok">Tag bold trovato nell'HTML risultante</span>\`
  })

  // ── italic ───────────────────────────────────────────────────────────────
  await runTest('italic', async () => {
    await reloadIframe()
    selectElementText('#body1')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('italic')
    const html = await changePromise
    assertHtmlContains(html, /<em>|<i>/i, 'italic')
    return \`<span class="ok">Tag italic trovato nell'HTML risultante</span>\`
  })

  // ── underline ────────────────────────────────────────────────────────────
  await runTest('underline', async () => {
    await reloadIframe()
    selectElementText('#body1')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('underline')
    const html = await changePromise
    assertHtmlContains(html, /<u>|text-decoration[^>]*underline/i, 'underline')
    return \`<span class="ok">Sottolineato trovato nell'HTML risultante</span>\`
  })

  // ── strikeThrough ────────────────────────────────────────────────────────
  await runTest('strikethrough', async () => {
    await reloadIframe()
    selectElementText('#body1')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('strikeThrough')
    const html = await changePromise
    assertHtmlContains(html, /<strike>|<s>|line-through/i, 'strikeThrough')
    return \`<span class="ok">Barrato trovato nell'HTML risultante</span>\`
  })

  // ── fontName ─────────────────────────────────────────────────────────────
  await runTest('fontname', async () => {
    await reloadIframe()
    selectElementText('#body2')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('fontName', 'Georgia')
    const html = await changePromise
    assertHtmlContains(html, /Georgia/i, 'fontName')
    return \`<span class="ok">Font name "Georgia" trovato nell'HTML risultante</span>\`
  })

  // ── foreColor ────────────────────────────────────────────────────────────
  await runTest('forecolor', async () => {
    await reloadIframe()
    selectElementText('#body2')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('foreColor', '#ff0000')
    const html = await changePromise
    assertHtmlContains(html, /color[^>]*(#ff0000|rgb\\(255,\\s*0,\\s*0\\)|red)/i, 'foreColor')
    return \`<span class="ok">Colore #ff0000 trovato nell'HTML risultante</span>\`
  })

  // ── formatBlock h1 ───────────────────────────────────────────────────────
  await runTest('fmt-h1', async () => {
    await reloadIframe()
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('formatBlock', 'h1')
    const html = await changePromise
    assertHtmlContains(html, /<h1/i, 'formatBlock h1')
    return \`<span class="ok">Tag &lt;h1&gt; trovato nell'HTML risultante</span>\`
  })

  // ── formatBlock h2 ───────────────────────────────────────────────────────
  await runTest('fmt-h2', async () => {
    await reloadIframe()
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('formatBlock', 'h2')
    const html = await changePromise
    assertHtmlContains(html, /<h2/i, 'formatBlock h2')
    return \`<span class="ok">Tag &lt;h2&gt; trovato nell'HTML risultante</span>\`
  })

  // ── formatBlock h3 ───────────────────────────────────────────────────────
  await runTest('fmt-h3', async () => {
    await reloadIframe()
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('formatBlock', 'h3')
    const html = await changePromise
    assertHtmlContains(html, /<h3/i, 'formatBlock h3')
    return \`<span class="ok">Tag &lt;h3&gt; trovato nell'HTML risultante</span>\`
  })

  // ── formatBlock p (ritorno a paragrafo) ──────────────────────────────────
  await runTest('fmt-p', async () => {
    await reloadIframe()
    // Prima converti in h2, poi riconverti in p
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    sendFormat('formatBlock', 'h2')
    await wait(300)
    // Ora converti in p
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('formatBlock', 'p')
    const html = await changePromise
    // Dopo la conversione in p, il contenuto del body3 deve essere in un <p>
    assertHtmlContains(html, /<p[^>]*>.*Terzo paragrafo/i, 'formatBlock p')
    return \`<span class="ok">Tag &lt;p&gt; ripristinato nell'HTML risultante</span>\`
  })

  // ── formatBlock blockquote ───────────────────────────────────────────────
  await runTest('fmt-blockquote', async () => {
    await reloadIframe()
    selectElementText('#body3')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('formatBlock', 'blockquote')
    const html = await changePromise
    assertHtmlContains(html, /<blockquote/i, 'formatBlock blockquote')
    return \`<span class="ok">Tag &lt;blockquote&gt; trovato nell'HTML risultante</span>\`
  })

  // ── insertHTML ───────────────────────────────────────────────────────────
  await runTest('insert-html', async () => {
    await reloadIframe()
    selectElementText('#insertTarget')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const marker = 'data-test-marker="blog-editor-test-xyz"'
    const changePromise = waitForHtmlChange()
    sendFormat('insertHTML', \`<span \${marker}>Testo inserito</span>\`)
    const html = await changePromise
    assertHtmlContains(html, marker, 'insertHTML')
    return \`<span class="ok">HTML inserito con marker trovato nell'output</span>\`
  })

  // ── justifyCenter ────────────────────────────────────────────────────────
  await runTest('justify-center', async () => {
    await reloadIframe()
    selectElementText('#body2')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('justifyCenter')
    const html = await changePromise
    assertHtmlContains(html, /text-align[^>]*center|align[^>]*center/i, 'justifyCenter')
    return \`<span class="ok">text-align:center trovato nell'HTML risultante</span>\`
  })

  // ── insertOrderedList ────────────────────────────────────────────────────
  await runTest('insert-ol', async () => {
    await reloadIframe()
    selectElementText('#insertTarget')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('insertOrderedList')
    const html = await changePromise
    assertHtmlContains(html, /<ol/i, 'insertOrderedList')
    return \`<span class="ok">Tag &lt;ol&gt; trovato nell'HTML risultante</span>\`
  })

  // ── insertUnorderedList ──────────────────────────────────────────────────
  await runTest('insert-ul', async () => {
    await reloadIframe()
    selectElementText('#insertTarget')
    iframe.contentWindow.postMessage({ type: 'fact-save-sel' }, '*')
    await wait(60)
    const changePromise = waitForHtmlChange()
    sendFormat('insertUnorderedList')
    const html = await changePromise
    assertHtmlContains(html, /<ul/i, 'insertUnorderedList')
    return \`<span class="ok">Tag &lt;ul&gt; trovato nell'HTML risultante</span>\`
  })

  // ── Fine ─────────────────────────────────────────────────────────────────
  updateSummary(false)

  const allPassed = failCount === 0
  document.querySelector('header').style.background = allPassed ? '#15803d' : '#991b1b'
  console.log(\`\\n\${allPassed ? '✅' : '❌'} \${passCount}/\${passCount + failCount} test passati\`)
}

// ── Avvia ─────────────────────────────────────────────────────────────────────
runAll().catch(err => {
  console.error('Errore runner:', err)
  updateSummary(false)
})
</script>
</body>
</html>`
}
