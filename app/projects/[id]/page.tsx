'use client'

import { useState, use, useRef, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Page = { slug: string; name: string; html: string }
type Version = { id: string; timestamp: string; summary: string; pages: Page[] }
type TextItem = { id: string; tag: string; label: string; text: string; originalText: string }

const INLINE_EDIT_SCRIPT = `(function(){
  var SKIP=new Set(['SCRIPT','STYLE','HEAD','META','LINK','IMG','VIDEO','AUDIO','IFRAME','INPUT','TEXTAREA','SELECT','CANVAS','NOSCRIPT','OBJECT','EMBED','SVG']);

  // Freeze all interactions: disable pointer events and hover effects on everything,
  // then re-enable only on elements we mark as editable.
  var globalStyle=document.createElement('style');
  globalStyle.id='fact-edit-global';
  globalStyle.textContent=
    '*{pointer-events:none!important;user-select:none!important;-webkit-user-select:none!important;'+
    'transition:none!important;animation-play-state:paused!important;}'+
    '[data-fact-edit]{pointer-events:auto!important;user-select:text!important;'+
    '-webkit-user-select:text!important;cursor:text!important;}';
  document.head.appendChild(globalStyle);

  function attach(el){
    if(el.getAttribute('contenteditable')==='true') return;
    el.contentEditable='true';
    el.dataset.factEdit='1';
    // Prevent any navigation or default click behaviour
    el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();});
    el.addEventListener('mouseenter',function(){
      if(document.activeElement!==el){el.style.outline='2px dashed rgba(37,99,235,0.5)';el.style.outlineOffset='3px';el.style.borderRadius='3px';}
    });
    el.addEventListener('mouseleave',function(){
      if(document.activeElement!==el){el.style.outline='';el.style.outlineOffset='';}
    });
    el.addEventListener('focus',function(){
      el.style.outline='2px solid #2563eb';el.style.outlineOffset='3px';el.style.borderRadius='3px';
    });
    el.addEventListener('blur',function(){
      el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';
    });
    el.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&/^(H[1-6]|BUTTON|A)$/.test(el.tagName)){e.preventDefault();}
    });
  }

  function run(){
    var walker=document.createTreeWalker(document.body,4/*NodeFilter.SHOW_TEXT*/);
    var node;
    while((node=walker.nextNode())){
      try{
        if(node.textContent.trim().length<1) continue;
        var p=node.parentElement;
        if(!p||SKIP.has(p.tagName)||p.isContentEditable) continue;
        attach(p);
      }catch(e){}
    }
  }

  run();
  setTimeout(run,300);

  var timer;
  document.addEventListener('input',function(){
    clearTimeout(timer);
    timer=setTimeout(function(){
      var clone=document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-fact-edit]').forEach(function(el){
        el.removeAttribute('contenteditable');
        el.removeAttribute('data-fact-edit');
        el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';
      });
      // Remove all editor artefacts so the saved HTML is clean
      ['#fact-edit-global','#fact-edit-script','#fact-edit-marker'].forEach(function(sel){
        var el=clone.querySelector(sel); if(el) el.remove();
      });
      window.parent.postMessage({type:'html-change',html:'<!DOCTYPE html>\\n'+clone.outerHTML},'*');
    },400);
  });
})();`

function stripHtmlFromChat(content: string): string {
  if (!content) return ''
  const codeMatch = content.indexOf('```')
  const htmlTagMatch = content.search(/<[a-zA-Z!]/)
  const candidates = [codeMatch, htmlTagMatch].filter(i => i >= 0)
  const cutAt = candidates.length > 0 ? Math.min(...candidates) : -1
  const prose = cutAt >= 0 ? content.slice(0, cutAt).trim() : content.trim()
  const isComplete = /<\/html>\s*(```)?\s*$/i.test(content) || /```\s*$/.test(content.trim())
  if (cutAt >= 0) {
    const status = isComplete ? '✨ Sito generato' : '✨ Sto generando il sito...'
    return prose ? `${prose}\n\n${status}` : status
  }
  return prose
}

const TAG_LABELS: Record<string, string> = {
  h1: 'Titolo H1', h2: 'Titolo H2', h3: 'Titolo H3', h4: 'Titolo H4', h5: 'Titolo H5', h6: 'Titolo H6',
  p: 'Paragrafo', li: 'Voce lista', a: 'Link', button: 'Bottone',
}

function extractTextItems(html: string): TextItem[] {
  if (typeof window === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items: TextItem[] = []
  const seen = new Set<string>()
  let i = 0
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button').forEach(el => {
    // Use direct TEXT_NODE children only — this handles elements like
    // <h1>Title<span class="dot">.</span></h1> where the editable part
    // is the text node "Title", not the full textContent "Title."
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3 /* TEXT_NODE */)
      .map(n => n.textContent?.trim() ?? '')
      .join(' ')
      .trim()
    // For pure leaf nodes fall back to full textContent
    const text = directText || (el.children.length === 0 ? el.textContent?.trim() ?? '' : '')
    if (!text || text.length < 2 || text.length > 500 || seen.has(text)) return
    seen.add(text)
    const tag = el.tagName.toLowerCase()
    items.push({ id: `t_${i++}`, tag, label: TAG_LABELS[tag] || tag, text, originalText: text })
  })
  return items
}

function applyTextChanges(html: string, items: TextItem[]): string {
  if (typeof window === 'undefined') return html
  const changed = items.filter(i => i.text !== i.originalText)
  if (changed.length === 0) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')

  for (const item of changed) {
    // Walk all text nodes in the body and find the one matching originalText
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const tn = node as Text
      if (tn.textContent?.trim() === item.originalText) {
        // Preserve surrounding whitespace (indentation / newlines)
        const raw = tn.textContent
        const leading = raw.match(/^\s*/)?.[0] ?? ''
        const trailing = raw.match(/\s*$/)?.[0] ?? ''
        tn.textContent = leading + item.text + trailing
        break
      }
    }
  }

  const hasDoctype = /^\s*<!DOCTYPE/i.test(html)
  const result = doc.documentElement.outerHTML
  return hasDoctype ? '<!DOCTYPE html>\n' + result : result
}

function groupVersionsByDay(versions: Version[]): { label: string; items: Version[] }[] {
  const groups = new Map<string, Version[]>()
  const now = new Date()
  for (const v of [...versions].reverse()) {
    const d = new Date(v.timestamp)
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    const label = diffDays === 0 ? 'Oggi' : diffDays === 1 ? 'Ieri'
      : d.toLocaleDateString('it-IT', { weekday: 'long' }).replace(/^\w/, c => c.toUpperCase())
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(v)
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }))
}

function stripEditorArtifacts(html: string): string {
  if (typeof window === 'undefined' || !html) return html
  // Quick exit if no markers present
  if (!/fact-edit|contenteditable|html-change/i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Any inline script that references the editor (id-based or content-based, for legacy saves)
  doc.querySelectorAll('script').forEach(s => {
    const txt = s.textContent || ''
    if (s.id === 'fact-edit-script' || /fact-edit|html-change|data-fact-edit/.test(txt)) {
      s.remove()
    }
  })

  // Style and marker by id
  doc.querySelectorAll('style#fact-edit-global, #fact-edit-marker, meta[data-fact-edit-loaded]').forEach(el => el.remove())

  // Residual attributes from interrupted edit sessions
  doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'))
  doc.querySelectorAll('[data-fact-edit]').forEach(el => el.removeAttribute('data-fact-edit'))
  doc.querySelectorAll('[data-fact-href]').forEach(el => el.removeAttribute('data-fact-href'))

  const hasDoctype = /^\s*<!DOCTYPE/i.test(html)
  return (hasDoctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML
}

function injectBase(html: string, projectSlug: string): string {
  const clean = stripEditorArtifacts(html)
  const baseTag = `<base href="/preview/${projectSlug}/">`
  if (/<head[^>]*>/i.test(clean)) {
    return clean.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
  }
  return baseTag + clean
}

// ---- Design Tokens ----
const C = {
  bg: '#faf9f7',
  bgPanel: '#f4f2ef',
  border: '#e8e4de',
  borderLight: '#f0ede8',
  text: '#1a1a1a',
  textMuted: '#6b6563',
  textFaint: '#9b9896',
  userBubble: '#f0ebe1',
  white: '#ffffff',
  blue: '#2563eb',
  blueHover: '#1d4ed8',
  dark: '#1a1a1a',
}

function ToolbarBtn({
  label, active, onClick, title,
}: {
  label: React.ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '5px 10px', borderRadius: '7px', border: 'none',
        background: active ? C.blue : 'transparent',
        color: active ? 'white' : C.textMuted,
        fontSize: '0.78rem', fontWeight: active ? 600 : 400,
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background 0.12s',
        whiteSpace: 'nowrap' as const,
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)' }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {label}
    </button>
  )
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pages, setPages] = useState<Page[]>([])
  const [activeSlug, setActiveSlug] = useState<string>('home')
  const [projectName, setProjectName] = useState('')
  const [projectSlug, setProjectSlug] = useState('')
  const [copied, setCopied] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [chatWidth, setChatWidth] = useState(38)
  const [isDragging, setIsDragging] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [customDomain, setCustomDomain] = useState('')
  const [customDomainStatus, setCustomDomainStatus] = useState<string | null>(null)
  const [addingDomain, setAddingDomain] = useState(false)
  const [dnsInstructions, setDnsInstructions] = useState<string>('')
  const [verifying, setVerifying] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'text' | 'edit'>('preview')
  const [codeContent, setCodeContent] = useState('')
  const [versions, setVersions] = useState<Version[]>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null)
  const [textItems, setTextItems] = useState<TextItem[]>([])
  const [textDirty, setTextDirty] = useState(false)
  const [textSaving, setTextSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [codeSaving, setCodeSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editSrcDoc, setEditSrcDoc] = useState('')
  const [editSaving, setEditSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editOutdated, setEditOutdated] = useState(false)
  const [chatHidden, setChatHidden] = useState(false)
  const verifyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baseHtmlRef = useRef<string>('')
  const latestPagesRef = useRef<Page[]>([])
  const textScrollRef = useRef<HTMLDivElement>(null)
  const textPreviewIframeRef = useRef<HTMLIFrameElement>(null)
  const editIframeRef = useRef<HTMLIFrameElement>(null)
  const editBaseHtmlRef = useRef<string>('')

  const activePage = pages.find(p => p.slug === activeSlug) || pages[0]

  useEffect(() => { latestPagesRef.current = pages }, [pages])

  // Set editSrcDoc when entering edit mode (don't depend on pages to avoid iframe reload)
  useEffect(() => {
    if (viewMode === 'edit' && activePage && projectSlug) {
      editBaseHtmlRef.current = activePage.html
      setEditSrcDoc(injectBase(activePage.html, projectSlug))
      setEditSaving('idle')
      setEditOutdated(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeSlug, projectSlug])

  // Detect when AI updates pages while user is in edit mode
  useEffect(() => {
    if (viewMode !== 'edit' || !activePage) return
    if (activePage.html !== editBaseHtmlRef.current) {
      setEditOutdated(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  // Listen for inline edits coming from the iframe via postMessage
  useEffect(() => {
    if (viewMode !== 'edit') return
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'html-change' || !activePage) return
      const newHtml = e.data.html as string
      // Keep editBaseHtmlRef in sync so AI-change detection doesn't false-positive
      editBaseHtmlRef.current = newHtml
      const newPages = latestPagesRef.current.map(p =>
        p.slug === activePage.slug ? { ...p, html: newHtml } : p
      )
      setPages(newPages)
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(async () => {
        setEditSaving('saving')
        const curPages = latestPagesRef.current
        const newVersions = createVersion('Modifica inline', curPages, versions)
        await saveState(messages, curPages, newVersions)
        setEditSaving('saved')
        setTimeout(() => setEditSaving('idle'), 2000)
      }, 2000)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activePage?.slug, messages, versions])

  useEffect(() => {
    if (viewMode === 'code' && activePage) {
      setCodeContent(activePage.html)
      setCodeSaving('idle')
    }
    if (viewMode === 'text' && activePage) {
      baseHtmlRef.current = activePage.html
      setTextItems(extractTextItems(activePage.html))
      setTextDirty(false)
      setTextSaving('idle')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug, viewMode])

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      const pct = (e.clientX / window.innerWidth) * 100
      setChatWidth(Math.max(22, Math.min(75, pct)))
    }
    const handleUp = () => setIsDragging(false)
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const ROOT_DOMAIN = 'factulista.com'
  const publicBaseUrl = (() => {
    if (!projectSlug || typeof window === 'undefined') return ''
    const host = window.location.host
    const isProduction = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
    return isProduction
      ? `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
      : `${window.location.origin}/preview/${projectSlug}`
  })()
  const publicUrl = publicBaseUrl
    ? (activeSlug === 'home' ? publicBaseUrl : `${publicBaseUrl}/${activeSlug}`)
    : ''

  const copyUrl = async () => {
    if (!publicUrl) return
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setUploading(false); return }
    const ext = file.name.split('.').pop() || 'png'
    const path = `${session.user.id}/${id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
    if (error) { alert(`Errore upload: ${error.message}`); setUploading(false); return }
    const { data: { publicUrl: imageUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
    setInput(prev => `${prev}${prev ? ' ' : ''}Usa questa immagine: ${imageUrl}`)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    const load = async () => {
      const { data: project } = await supabase
        .from('projects')
        .select('name, slug, site_config, custom_domain, custom_domain_status')
        .eq('id', id)
        .single()
      if (!project) return
      setProjectName(project.name)
      setProjectSlug(project.slug)
      if (project.custom_domain) {
        setCustomDomain(project.custom_domain)
        setCustomDomainStatus(project.custom_domain_status)
      }
      const config = project.site_config as { html?: string; pages?: Page[]; messages?: Message[]; versions?: Version[] } | null
      let loadedPages: Page[] = []
      if (config?.pages?.length) loadedPages = config.pages
      else if (config?.html) loadedPages = [{ slug: 'home', name: 'Home', html: config.html }]
      // Strip any editor artefacts left over from previous edit sessions before fix
      loadedPages = loadedPages.map(p => ({ ...p, html: stripEditorArtifacts(p.html) }))
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) setMessages(config.messages)
      if (config?.versions) setVersions(config.versions)
    }
    load()
  }, [id])

  const createVersion = (summary: string, currentPages: Page[], currentVersions: Version[]): Version[] => {
    if (currentPages.length === 0) return currentVersions
    const v: Version = { id: `v_${Date.now()}`, timestamp: new Date().toISOString(), summary, pages: currentPages }
    const updated = [v, ...currentVersions].slice(0, 30)
    setVersions(updated)
    return updated
  }

  const saveState = async (newMessages: Message[], newPages: Page[], newVersions?: Version[]) => {
    const vers = newVersions ?? versions
    await supabase.from('projects').update({
      site_config: { pages: newPages, messages: newMessages, versions: vers },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  }

  const injectEditingScript = () => {
    const iframe = editIframeRef.current
    if (!iframe?.contentDocument?.body) return
    const existing = iframe.contentDocument.querySelector('[data-fact-edit-loaded]')
    if (existing) return // already injected
    const marker = iframe.contentDocument.createElement('meta')
    marker.setAttribute('data-fact-edit-loaded', '1')
    marker.id = 'fact-edit-marker'
    iframe.contentDocument.head.appendChild(marker)
    const script = iframe.contentDocument.createElement('script')
    script.id = 'fact-edit-script'
    script.textContent = INLINE_EDIT_SCRIPT
    iframe.contentDocument.body.appendChild(script)
  }

  const handleTextChange = (id: string, newText: string) => {
    // Update items state
    const updatedItems = textItems.map(item => item.id === id ? { ...item, text: newText } : item)
    setTextItems(updatedItems)
    setTextDirty(true)
    setTextSaving('idle')

    // Immediately apply to pages so Preview and HTML view stay in sync
    if (activePage) {
      const updatedHtml = applyTextChanges(baseHtmlRef.current, updatedItems)
      const newPages = pages.map(p => p.slug === activePage.slug ? { ...p, html: updatedHtml } : p)
      setPages(newPages)
    }

    // Debounce only the DB save
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      setTextSaving('saving')
      const curPages = latestPagesRef.current
      const newVersions = createVersion('Testo modificato manualmente', curPages, versions)
      await saveState(messages, curPages, newVersions)
      // Reset base so next edits are relative to saved state
      const savedHtml = curPages.find(p => p.slug === activePage?.slug)?.html
      if (savedHtml) baseHtmlRef.current = savedHtml
      setTextItems(prev => prev.map(item => ({ ...item, originalText: item.text })))
      setTextDirty(false)
      setTextSaving('saved')
      setTimeout(() => setTextSaving('idle'), 2000)
    }, 2000)
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userContent = input
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userContent }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        pages,
        activePageSlug: activeSlug,
        customDomain: customDomainStatus === 'verified' ? customDomain : null,
      }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: `❌ Errore: ${error.error || `HTTP ${res.status}`}` }
        : m))
      setLoading(false)
      return
    }

    // Consuma lo stream newline-delimited JSON
    const reader = res.body?.getReader()
    if (!reader) {
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Errore: Impossibile leggere la risposta' }
        : m))
      setLoading(false)
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: any = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Ultimo elemento (incompleto) rimane nel buffer

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)

            if (msg.type === 'progress') {
              // Mostra il progresso: "✏️ Content Agent... 0m 5s · 1.2k tokens"
              const tokenDisplay = msg.tokens > 1000 ? `${(msg.tokens / 1000).toFixed(1)}k` : msg.tokens
              const progressText = `${msg.step} • ${msg.time} • ${tokenDisplay} tokens`
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, content: progressText }
                : m))
            } else if (msg.type === 'done') {
              result = msg.result
            }
          } catch (e) {
            console.error('Errore parsing messaggio:', e)
          }
        }
      }
    } catch (err) {
      console.error('Errore lettura stream:', err)
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Errore nella comunicazione' }
        : m))
      setLoading(false)
      return
    }

    if (!result) {
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: '❌ Nessun risultato ricevuto' }
        : m))
      setLoading(false)
      return
    }

    let newPages: Page[] = pages
    let summary = ''
    let newActiveSlug = activeSlug

    if (result.tool === 'create_site') {
      newPages = result.input.pages as Page[]
      const steps = result.steps ? `\n${(result.steps as string[]).join('\n')}` : ''
      summary = `✨ ${result.input.summary}${steps}`
      if (newPages.length > 0) newActiveSlug = newPages[0].slug
    } else if (result.tool === 'edit_page') {
      const targetSlug = result.input.pageSlug as string
      const edits = result.input.edits as { find: string; replace: string }[]
      let skipped = 0
      newPages = pages.map(p => {
        if (p.slug !== targetSlug) return p
        let html = p.html
        for (const edit of edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
          else skipped++
        }
        return { ...p, html }
      })
      summary = `✏️ ${result.input.summary}${skipped ? ` (${skipped} edit non applicate)` : ''}`
      newActiveSlug = targetSlug
    } else if (result.tool === 'add_page') {
      const newPage: Page = { slug: result.input.slug, name: result.input.name, html: result.input.html }
      newPages = [...pages, newPage]
      summary = `➕ ${result.input.summary}`
      newActiveSlug = newPage.slug
    } else if (result.tool === 'delete_page') {
      const targetSlug = result.input.pageSlug as string
      if (targetSlug === 'home') {
        summary = '⚠️ La pagina "home" non può essere eliminata'
      } else {
        newPages = pages.filter(p => p.slug !== targetSlug)
        summary = `🗑 ${result.input.summary}`
        if (activeSlug === targetSlug) newActiveSlug = newPages[0]?.slug || 'home'
      }
    } else if (result.tool === 'update_seo') {
      const seoPages = result.input.pages as { pageSlug: string; edits: { find: string; replace: string }[] }[]
      let skipped = 0
      newPages = pages.map(p => {
        const seoPage = seoPages.find(sp => sp.pageSlug === p.slug)
        if (!seoPage) return p
        let html = p.html
        for (const edit of seoPage.edits) {
          if (html.includes(edit.find)) html = html.replace(edit.find, edit.replace)
          else skipped++
        }
        return { ...p, html }
      })
      summary = `🔍 ${result.input.summary}${skipped ? ` (${skipped} edit non applicate)` : ''}`
    } else if (result.tool === 'generate_sitemap') {
      summary = `🗺️ ${result.input.summary}`
    }

    setPages(newPages)
    setActiveSlug(newActiveSlug)
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
    const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
    const newVersions = createVersion(summary.slice(0, 60).replace(/^[✨✏️➕🗑🔍🗺️🎨✍️]\s*/, ''), newPages, versions)
    await saveState(finalMessages, newPages, newVersions)
    setLoading(false)
  }

  const handleDeletePage = async (slug: string) => {
    if (slug === 'home') { alert('La pagina "home" non può essere eliminata'); return }
    if (!confirm(`Eliminare la pagina "${slug}"?`)) return
    const newPages = pages.filter(p => p.slug !== slug)
    setPages(newPages)
    if (activeSlug === slug) setActiveSlug(newPages[0]?.slug || 'home')
    await saveState(messages, newPages)
  }

  const handleAddCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customDomain.trim()) return
    setAddingDomain(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/add-custom-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id, domain: customDomain.trim() }),
      })
      const result = await res.json()
      if (!res.ok) { alert(`Errore: ${result.error}`); setAddingDomain(false); return }
      setCustomDomainStatus(result.status)
      setDnsInstructions(result.message)
      setAddingDomain(false)
      if (result.status === 'pending') startPolling()
    } catch { alert('Errore nella richiesta'); setAddingDomain(false) }
  }

  const startPolling = () => {
    if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current)
    setVerifying(true)
    verifyIntervalRef.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/verify-custom-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ projectId: id }),
        })
        const result = await res.json()
        if (result.status === 'verified') {
          setCustomDomainStatus('verified')
          setVerifying(false)
          clearInterval(verifyIntervalRef.current!)
          verifyIntervalRef.current = null
        }
      } catch { /* ignore */ }
    }, 15000)
  }

  const handlePublish = async () => {
    if (!confirm(`Pubblicare su ${customDomain}?`)) return
    setPublishing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/publish-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id }),
      })
      const result = await res.json()
      if (!res.ok) { alert(`Errore: ${result.error}`); return }
      setPublishedAt(result.publishedAt)
    } catch { alert('Errore nella pubblicazione') }
    finally { setPublishing(false) }
  }

  useEffect(() => {
    if (customDomainStatus === 'pending') startPolling()
    return () => { if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDomainStatus === 'pending'])

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: C.bg }}>

      {/* ── Chat panel ── */}
      <div style={{ width: chatHidden ? '0' : `${chatWidth}%`, minWidth: chatHidden ? '0' : undefined, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg, borderRight: chatHidden ? 'none' : `1px solid ${C.border}`, transition: 'width 0.2s ease', flexShrink: 0 }}>

        {/* Chat header */}
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.bg, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link href="/projects" style={{ textDecoration: 'none', color: C.textFaint, fontSize: '1rem', display: 'flex', alignItems: 'center' }} title="Tutti i progetti">
              ←
            </Link>
            <div>
              <p style={{ margin: 0, fontSize: '0.8375rem', fontWeight: 600, color: C.text, lineHeight: 1.2 }}>{projectName || 'Progetto'}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: C.textFaint, lineHeight: 1.2 }}>Ultima versione salvata</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <ToolbarBtn
              label="◷"
              title="Cronologia versioni"
              active={showVersionHistory}
              onClick={() => setShowVersionHistory(v => !v)}
            />
            <ToolbarBtn
              label={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" stroke="currentColor"/>
                  <line x1="5" y1="1" x2="5" y2="13" stroke="currentColor"/>
                </svg>
              }
              title={chatHidden ? 'Mostra chat' : 'Nascondi chat'}
              active={chatHidden}
              onClick={() => setChatHidden(v => !v)}
            />
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
              <p style={{ fontSize: '0.9375rem', color: '#57534e', marginBottom: '0.4rem', fontWeight: 500 }}>Descrivi il sito che vuoi creare</p>
              <p style={{ fontSize: '0.8125rem', color: C.textFaint }}>Es: &quot;Un sito per il mio ristorante a Milano, elegante e moderno&quot;</p>
            </div>
          )}

          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: '82%', padding: '10px 14px',
                  background: C.userBubble, color: C.text,
                  borderRadius: '14px', fontSize: '0.9rem', lineHeight: '1.55',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ width: '22px', height: '22px', background: 'linear-gradient(135deg, #ff6b6b, #ffa94d)', borderRadius: '6px', flexShrink: 0, marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'white', fontSize: '0.6rem', fontWeight: 700 }}>F</span>
                </div>
                <div style={{ fontSize: '0.9rem', lineHeight: '1.65', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                  {stripHtmlFromChat(msg.content) || (loading ? (
                    <span style={{ color: C.textFaint, letterSpacing: '0.1em' }}>● ● ●</span>
                  ) : '')}
                </div>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '8px 10px 12px', flexShrink: 0 }}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          <form onSubmit={handleSend}>
            <div style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}>
              <textarea
                ref={textareaRef}
                placeholder="Descrivi il tuo sito o chiedi modifiche..."
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (input.trim() && !loading) handleSend(e as unknown as React.FormEvent)
                  }
                }}
                disabled={loading}
                rows={1}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  fontSize: '0.9rem', padding: '12px 14px 6px',
                  background: 'transparent', color: C.text,
                  resize: 'none', overflow: 'hidden', lineHeight: '1.5',
                  fontFamily: 'inherit', minHeight: '24px', maxHeight: '180px',
                  display: 'block', boxSizing: 'border-box' as const,
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || uploading}
                    style={{
                      background: 'transparent', color: C.textFaint, border: `1px solid ${C.border}`,
                      padding: '4px 9px', fontSize: '0.78rem', borderRadius: '6px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {uploading ? '⏳' : '@ Immagine'}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: input.trim() && !loading ? C.dark : '#d6d3d1',
                    color: 'white', border: 'none',
                    cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                    fontSize: '0.9rem', flexShrink: 0,
                  }}
                  title="Invia"
                >
                  {loading ? '⏳' : '↑'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* ── Resize handle ── */}
      {!chatHidden && (
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging(true) }}
          style={{
            width: '5px', cursor: 'col-resize', flexShrink: 0, zIndex: 10,
            background: isDragging ? C.blue : 'transparent',
            transition: isDragging ? 'none' : 'background 0.15s',
          }}
          onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = C.border }}
          onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        />
      )}
      {isDragging && <div style={{ position: 'fixed', inset: 0, cursor: 'col-resize', zIndex: 9999 }} />}

      {/* ── Preview panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bgPanel, overflow: 'hidden', minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderBottom: `1px solid ${C.border}`,
          background: C.bg, flexShrink: 0, gap: '8px',
        }}>
          {/* Left tools */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {chatHidden && (
              <ToolbarBtn
                label={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" stroke="currentColor"/>
                    <line x1="5" y1="1" x2="5" y2="13" stroke="currentColor"/>
                  </svg>
                }
                title="Mostra chat"
                onClick={() => setChatHidden(false)}
              />
            )}
            <ToolbarBtn
              label="🌐"
              title="Preview"
              active={viewMode === 'preview'}
              onClick={() => setViewMode('preview')}
            />
            <ToolbarBtn
              label="</>"
              title="Codice HTML"
              active={viewMode === 'code'}
              onClick={() => {
                setCodeContent(activePage?.html ?? '')
                setCodeSaving('idle')
                setViewMode('code')
              }}
            />
            <ToolbarBtn
              label="Aa"
              title="Editor testo"
              active={viewMode === 'text'}
              onClick={() => setViewMode('text')}
            />
            <ToolbarBtn
              label="✎"
              title="Editor inline (clicca sul testo)"
              active={viewMode === 'edit'}
              onClick={() => setViewMode('edit')}
            />
          </div>

          {/* URL bar */}
          <div style={{
            flex: 1, maxWidth: '340px',
            display: 'flex', alignItems: 'center', gap: '6px',
            background: C.white, border: `1px solid ${C.border}`,
            borderRadius: '7px', padding: '4px 8px',
          }}>
            <span style={{ fontSize: '0.75rem', color: C.textFaint }}>□</span>
            {publicUrl ? (
              <a
                href={publicUrl} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, fontSize: '0.75rem', color: C.text, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}
              >
                {publicUrl.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              <span style={{ flex: 1, fontSize: '0.75rem', color: C.textFaint }}>—</span>
            )}
            {publicUrl && (
              <button onClick={copyUrl} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: copied ? '#10b981' : C.textFaint, fontSize: '0.75rem', flexShrink: 0 }} title="Copia URL">
                {copied ? '✓' : '⧉'}
              </button>
            )}
          </div>

          {/* Right actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ToolbarBtn label="↗" title="Apri in nuova scheda" />
              </a>
            )}
            <button
              onClick={() => setShowSettingsModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 10px', borderRadius: '7px',
                border: `1px solid ${C.border}`,
                background: C.white, color: C.text,
                fontSize: '0.78rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ⚙ Impostazioni
            </button>
            {customDomainStatus === 'verified' && (
              <button
                onClick={handlePublish}
                disabled={publishing || pages.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 14px', borderRadius: '7px',
                  background: publishing ? '#93c5fd' : C.blue,
                  color: 'white', border: 'none',
                  fontSize: '0.78rem', fontWeight: 600,
                  cursor: publishing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {publishing ? '⏳' : '🚀'} Pubblica
              </button>
            )}
          </div>
        </div>

        {/* Page tabs */}
        {pages.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '6px 10px', borderBottom: `1px solid ${C.border}`, background: C.bg, overflowX: 'auto', flexShrink: 0 }}>
            {pages.map(p => (
              <div key={p.slug} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveSlug(p.slug)}
                  style={{
                    padding: '4px 12px', borderRadius: '6px', fontSize: '0.78rem', whiteSpace: 'nowrap',
                    background: p.slug === activeSlug ? C.white : 'transparent',
                    color: p.slug === activeSlug ? C.text : C.textMuted,
                    border: p.slug === activeSlug ? `1px solid ${C.border}` : '1px solid transparent',
                    fontWeight: p.slug === activeSlug ? 600 : 400,
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: p.slug === activeSlug ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                  }}
                >
                  {p.name}
                </button>
                {p.slug !== 'home' && p.slug === activeSlug && (
                  <button
                    onClick={() => handleDeletePage(p.slug)}
                    style={{ background: 'transparent', color: '#ef4444', border: 'none', padding: '2px 5px', fontSize: '0.85rem', cursor: 'pointer' }}
                    title="Elimina pagina"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Version history panel */}
        {showVersionHistory ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>Cronologia versioni</span>
              <button onClick={() => setShowVersionHistory(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '1.1rem', padding: '2px 6px' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {versions.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: C.textFaint, fontSize: '0.85rem' }}>
                  Nessuna versione ancora.<br />Le versioni vengono salvate automaticamente.
                </div>
              ) : groupVersionsByDay(versions).map(group => (
                <div key={group.label}>
                  <div style={{ padding: '10px 18px 4px', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {group.label}
                  </div>
                  {group.items.map(v => (
                    <div
                      key={v.id}
                      onMouseEnter={() => setHoveredVersionId(v.id)}
                      onMouseLeave={() => setHoveredVersionId(null)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 18px', cursor: 'default',
                        background: hoveredVersionId === v.id ? C.bgPanel : 'transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      <div>
                        <p style={{ margin: 0, fontSize: '0.8375rem', color: C.text, fontWeight: 400 }}>{v.summary || 'Versione salvata'}</p>
                        <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: C.textFaint }}>
                          {new Date(v.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {hoveredVersionId === v.id && (
                        <button
                          title="Ripristina questa versione"
                          onClick={async () => {
                            if (!confirm('Ripristinare questa versione? Le modifiche attuali verranno sovrascritte.')) return
                            const newVersions = createVersion('Ripristino versione precedente', pages, versions)
                            setPages(v.pages)
                            setActiveSlug(v.pages[0]?.slug || 'home')
                            await saveState(messages, v.pages, newVersions)
                            setShowVersionHistory(false)
                          }}
                          style={{
                            background: 'transparent', border: `1px solid ${C.border}`, borderRadius: '6px',
                            padding: '5px 10px', cursor: 'pointer', color: C.textMuted, fontSize: '0.9rem',
                            display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                          }}
                        >
                          ↩
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : viewMode === 'edit' && activePage ? (
          /* Inline editor v2 — contentEditable inside iframe */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg }}>
              <span style={{ fontSize: '0.75rem', color: C.textFaint }}>
                ✎ Clicca su qualsiasi testo per modificarlo direttamente
              </span>
              <span style={{ fontSize: '0.72rem', color: editSaving === 'saving' ? '#f59e0b' : editSaving === 'saved' ? '#10b981' : C.textFaint }}>
                {editSaving === 'saving' ? '⏳ Salvataggio...' : editSaving === 'saved' ? '✓ Salvato' : 'Auto-save attivo'}
              </span>
            </div>
            {editOutdated && (
              <div
                onClick={() => {
                  if (!activePage) return
                  editBaseHtmlRef.current = activePage.html
                  setEditSrcDoc(injectBase(activePage.html, projectSlug))
                  setEditOutdated(false)
                }}
                style={{
                  padding: '10px 16px', background: '#1d4ed8', color: 'white',
                  fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexShrink: 0,
                }}
              >
                <span>↻ Il sito è stato aggiornato dall&apos;AI — clicca per ricaricare l&apos;editor</span>
                <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>Le modifiche inline non salvate andranno perse</span>
              </div>
            )}
            <iframe
              ref={editIframeRef}
              srcDoc={editSrcDoc}
              onLoad={injectEditingScript}
              style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
              title="Inline editor"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        ) : viewMode === 'text' && activePage ? (
          /* Text editor — split: fields left, live preview right */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: text fields */}
            <div style={{ width: '40%', minWidth: '260px', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.border}`, background: C.bg }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                <span style={{ fontSize: '0.75rem', color: C.textFaint }}>Testi — {activePage.name}</span>
                <span style={{ fontSize: '0.72rem', color: textSaving === 'saving' ? '#f59e0b' : textSaving === 'saved' ? '#10b981' : C.textFaint }}>
                  {textSaving === 'saving' ? '⏳ Salvataggio...' : textSaving === 'saved' ? '✓ Salvato' : textDirty ? 'Non salvato...' : 'Auto-save'}
                </span>
              </div>
              <div
                ref={textScrollRef}
                onScroll={() => {
                  const el = textScrollRef.current
                  const iframe = textPreviewIframeRef.current
                  if (!el || !iframe?.contentWindow) return
                  const pct = el.scrollTop / (el.scrollHeight - el.clientHeight || 1)
                  const iDoc = iframe.contentDocument || iframe.contentWindow.document
                  const maxScroll = iDoc.body.scrollHeight - iframe.clientHeight
                  iframe.contentWindow.scrollTo({ top: pct * maxScroll, behavior: 'instant' })
                }}
                style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}
              >
                {textItems.length === 0 ? (
                  <p style={{ color: C.textFaint, fontSize: '0.85rem', textAlign: 'center', marginTop: '40px' }}>
                    Nessun testo trovato. Prova a generare il sito prima.
                  </p>
                ) : textItems.map(item => (
                  <div key={item.id}>
                    <label style={{ display: 'block', fontSize: '0.67rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                      {item.label}
                    </label>
                    {item.text.length > 80 || item.tag === 'p' ? (
                      <textarea
                        value={item.text}
                        onChange={e => handleTextChange(item.id, e.target.value)}
                        rows={3}
                        style={{
                          width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px',
                          padding: '8px 10px', fontSize: '0.85rem', color: C.text,
                          background: C.white, fontFamily: 'inherit', resize: 'vertical',
                          outline: 'none', lineHeight: '1.55', boxSizing: 'border-box' as const,
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = C.blue }}
                        onBlur={e => { e.currentTarget.style.borderColor = C.border }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={item.text}
                        onChange={e => handleTextChange(item.id, e.target.value)}
                        style={{
                          width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px',
                          padding: '8px 10px', fontSize: '0.85rem', color: C.text,
                          background: C.white, fontFamily: 'inherit',
                          outline: 'none', boxSizing: 'border-box' as const,
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = C.blue }}
                        onBlur={e => { e.currentTarget.style.borderColor = C.border }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Right: live preview */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg }}>
                <span style={{ fontSize: '0.75rem', color: C.textFaint }}>Preview live</span>
              </div>
              <iframe
                ref={textPreviewIframeRef}
                srcDoc={injectBase(activePage.html, projectSlug)}
                style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
                title="Live preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        ) : viewMode === 'code' && activePage ? (
          /* Code editor */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1e1e1e' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #333', flexShrink: 0 }}>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace' }}>{activePage.slug}.html</span>
              <span style={{ fontSize: '0.72rem', color: codeSaving === 'saving' ? '#f59e0b' : codeSaving === 'saved' ? '#10b981' : '#6b7280' }}>
                {codeSaving === 'saving' ? '⏳ Salvataggio...' : codeSaving === 'saved' ? '✓ Salvato' : 'Auto-save attivo'}
              </span>
            </div>
            <textarea
              value={codeContent}
              onChange={(e) => {
                const val = e.target.value
                setCodeContent(val)
                setCodeSaving('idle')
                // Immediately update pages so Preview and Text view stay in sync
                const newPages = pages.map(p => p.slug === activePage.slug ? { ...p, html: val } : p)
                setPages(newPages)
                // Debounce only the DB save
                if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current)
                codeAutoSaveTimer.current = setTimeout(async () => {
                  setCodeSaving('saving')
                  const curPages = latestPagesRef.current
                  const newVersions = createVersion('Modifica HTML manuale', curPages, versions)
                  await saveState(messages, curPages, newVersions)
                  setCodeSaving('saved')
                  setTimeout(() => setCodeSaving('idle'), 2000)
                }, 2000)
              }}
              spellCheck={false}
              style={{
                flex: 1, border: 'none', outline: 'none', resize: 'none',
                background: '#1e1e1e', color: '#d4d4d4',
                fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
                fontSize: '0.8125rem', lineHeight: '1.6',
                padding: '14px 18px', overflowY: 'auto',
                tabSize: 2,
              }}
            />
          </div>
        ) : activePage ? (
          <iframe
            srcDoc={injectBase(activePage.html, projectSlug)}
            style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
            title="Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textFaint, flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '2rem', opacity: 0.3 }}>◉</div>
            <p style={{ fontSize: '0.875rem' }}>La preview apparirà qui dopo che l&apos;AI genera il sito</p>
          </div>
        )}
      </div>

      {/* ── Settings Modal ── */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: C.white, borderRadius: '14px', padding: '1.75rem', maxWidth: '480px', width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: C.text }}>Impostazioni Progetto</h2>
              <button onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
                style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: C.textFaint, padding: '2px 6px' }}>×</button>
            </div>

            {/* Staging domain */}
            <div style={{ marginBottom: '1.25rem', padding: '12px 14px', background: C.bg, borderRadius: '10px', border: `1px solid ${C.border}` }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: C.textFaint, fontWeight: 500 }}>Dominio di preview (staging)</p>
              <p style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>myweb.factulista.com/{projectSlug}</p>
            </div>

            {customDomainStatus === 'verified' ? (
              <>
                <div style={{ marginBottom: '1rem', padding: '12px 14px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: C.textFaint }}>Dominio personalizzato</p>
                  <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>{customDomain}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#059669' }}>✓ Verificato e attivo</p>
                </div>
                <button
                  onClick={handlePublish}
                  disabled={publishing || pages.length === 0}
                  style={{ width: '100%', padding: '10px', background: publishing ? '#93c5fd' : C.blue, color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, fontSize: '0.875rem', cursor: publishing ? 'not-allowed' : 'pointer', marginBottom: '8px', fontFamily: 'inherit' }}>
                  {publishing ? '⏳ Pubblicazione...' : `🚀 Pubblica su ${customDomain}`}
                </button>
                {publishedAt && (
                  <p style={{ margin: '0 0 1rem', fontSize: '0.75rem', color: '#059669', textAlign: 'center' }}>
                    ✓ Pubblicato il {new Date(publishedAt).toLocaleString('it-IT')}
                  </p>
                )}
              </>
            ) : customDomainStatus === 'pending' ? (
              <div style={{ marginBottom: '1rem', padding: '12px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.75rem', color: C.textMuted }}>In attesa di verifica DNS</span>
                  {verifying && <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>● verifica in corso...</span>}
                </div>
                <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>{customDomain}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#92400e' }}>La verifica è automatica, può richiedere fino a 15 minuti</p>
              </div>
            ) : (
              <form onSubmit={handleAddCustomDomain} style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.8125rem', fontWeight: 500, color: C.text }}>
                  Dominio personalizzato (produzione)
                </label>
                <input
                  type="text"
                  placeholder="es: miodominio.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  disabled={addingDomain}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '10px', fontSize: '0.875rem', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none' }}
                />
                <button
                  type="submit"
                  disabled={addingDomain || !customDomain.trim()}
                  style={{ width: '100%', padding: '9px', background: customDomain.trim() && !addingDomain ? C.dark : '#d6d3d1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: customDomain.trim() && !addingDomain ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontFamily: 'inherit' }}>
                  {addingDomain ? '⏳ Configurazione...' : 'Aggiungi dominio'}
                </button>
              </form>
            )}

            {dnsInstructions && (
              <div style={{ padding: '12px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '1rem' }}>
                <p style={{ margin: '0 0 6px', fontSize: '0.8125rem', fontWeight: 600, color: C.text }}>Configura il tuo DNS:</p>
                <pre style={{ margin: 0, fontSize: '0.75rem', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>{dnsInstructions}</pre>
                <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: C.textMuted }}>La verifica può richiedere fino a 15 minuti.</p>
              </div>
            )}

            <button
              onClick={() => { setShowSettingsModal(false); setDnsInstructions('') }}
              style={{ width: '100%', padding: '9px', background: C.bgPanel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem' }}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
