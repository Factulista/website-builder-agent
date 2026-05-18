'use client'

import { useState, use, useRef, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { confirmDialog, alertDialog } from '../../../lib/dialog'
import { EditorSidebar } from '../../../components/EditorSidebar'
import { HtmlCodeEditor } from '../../../components/HtmlCodeEditor'
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'

type Message = { id: string; role: 'user' | 'assistant'; content: string; failed?: boolean; retryInput?: string; retryImages?: string[] }
export type Page = { slug: string; name: string; html: string }
type Version = { id: string; timestamp: string; summary: string; pages: Page[] }
type MediaMeta = { alt?: string; title?: string; caption?: string; description?: string }
type MediaItem = { path: string; name: string; size: number; createdAt: string; url: string }
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

function stripHtmlFromChat(content: string, language: string): string {
  if (!content) return ''
  const codeMatch = content.indexOf('```')
  const htmlTagMatch = content.search(/<[a-zA-Z!]/)
  const candidates = [codeMatch, htmlTagMatch].filter(i => i >= 0)
  const cutAt = candidates.length > 0 ? Math.min(...candidates) : -1
  const prose = cutAt >= 0 ? content.slice(0, cutAt).trim() : content.trim()
  const htmlComplete = /<\/html>\s*(```)?\s*$/i.test(content) || /```\s*$/.test(content.trim())
  if (cutAt >= 0) {
    const status = htmlComplete ? `✨ ${t('project.siteGenerated' as const, language as any)}` : `✨ ${t('project.generatingSite' as const, language as any)}`
    return prose ? `${prose}\n\n${status}` : status
  }
  return prose
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

function applyMediaMetaToPages(pages: Page[], url: string, meta: MediaMeta): Page[] {
  if (typeof window === 'undefined') return pages
  let anyChanged = false
  const next = pages.map(page => {
    if (!page.html.includes(url)) return page
    const doc = new DOMParser().parseFromString(page.html, 'text/html')
    let pageChanged = false
    doc.querySelectorAll('img').forEach(img => {
      if (img.getAttribute('src') !== url) return
      if (meta.alt !== undefined && img.getAttribute('alt') !== meta.alt) {
        img.setAttribute('alt', meta.alt); pageChanged = true
      }
      if (meta.title !== undefined) {
        const current = img.getAttribute('title') || ''
        if (meta.title && current !== meta.title) { img.setAttribute('title', meta.title); pageChanged = true }
        else if (!meta.title && img.hasAttribute('title')) { img.removeAttribute('title'); pageChanged = true }
      }
    })
    if (!pageChanged) return page
    anyChanged = true
    const hasDoctype = /^\s*<!DOCTYPE/i.test(page.html)
    return { ...page, html: (hasDoctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML }
  })
  return anyChanged ? next : pages
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
  const { language } = useLanguage()
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
  const [dragOverChat, setDragOverChat] = useState(false)
  const [dragOverMedia, setDragOverMedia] = useState(false)
  const [attachedImages, setAttachedImages] = useState<string[]>([])
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
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'edit' | 'media'>('preview')
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaSearch, setMediaSearch] = useState('')
  const [mediaSort, setMediaSort] = useState<'recent' | 'oldest' | 'name'>('recent')
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const [mediaMeta, setMediaMeta] = useState<Record<string, MediaMeta>>({})
  const [mediaUrlCopied, setMediaUrlCopied] = useState(false)
  const [codeContent, setCodeContent] = useState('')
  const [versions, setVersions] = useState<Version[]>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null)
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
  const latestPagesRef = useRef<Page[]>([])
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

  const uploadImageFile = async (file: File, target: 'chat' | 'media' = 'chat') => {
    if (!file.type.startsWith('image/')) { await alertDialog('Solo immagini supportate'); return }
    setUploading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setUploading(false); return }
    const ext = file.name.split('.').pop() || 'png'
    const path = `${session.user.id}/${id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
    if (error) { await alertDialog({ title: 'Errore upload', message: error.message, variant: 'danger' }); setUploading(false); return }
    const { data: { publicUrl: imageUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
    if (target === 'chat') {
      setAttachedImages(prev => [...prev, imageUrl])
    }
    setUploading(false)
    if (target === 'media' || viewMode === 'media') loadMedia()
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // "+ Aggiungi" button in media view → media target; chat paperclip → chat target
    const target = viewMode === 'media' ? 'media' : 'chat'
    await uploadImageFile(file, target)
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
      const config = project.site_config as { html?: string; pages?: Page[]; messages?: Message[]; versions?: Version[]; media?: Record<string, MediaMeta> } | null
      let loadedPages: Page[] = []
      if (config?.pages?.length) loadedPages = config.pages
      else if (config?.html) loadedPages = [{ slug: 'home', name: 'Home', html: config.html }]
      // Strip any editor artefacts left over from previous edit sessions before fix
      loadedPages = loadedPages.map(p => ({ ...p, html: stripEditorArtifacts(p.html) }))
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) setMessages(config.messages)
      if (config?.versions) setVersions(config.versions)
      if (config?.media) setMediaMeta(config.media)
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

  const saveState = async (newMessages: Message[], newPages: Page[], newVersions?: Version[], newMedia?: Record<string, MediaMeta>) => {
    const vers = newVersions ?? versions
    const med = newMedia ?? mediaMeta
    await supabase.from('projects').update({
      site_config: { pages: newPages, messages: newMessages, versions: vers, media: med },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  }

  const loadMedia = async () => {
    setMediaLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setMediaLoading(false); return }
    const folder = `${session.user.id}/${id}`
    const { data: files } = await supabase.storage.from('project-assets').list(folder, {
      sortBy: { column: 'created_at', order: 'desc' },
      limit: 1000,
    })
    if (!files) { setMediaLoading(false); return }
    const items: MediaItem[] = files
      .filter(f => f.name && !f.name.endsWith('/') && f.metadata)
      .map(f => ({
        path: `${folder}/${f.name}`,
        name: f.name,
        size: (f.metadata?.size as number) || 0,
        createdAt: f.created_at || '',
        url: supabase.storage.from('project-assets').getPublicUrl(`${folder}/${f.name}`).data.publicUrl,
      }))
    setMediaItems(items)
    setMediaLoading(false)
  }

  useEffect(() => {
    if (viewMode === 'media') loadMedia()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, id])

  const updateMediaMeta = (path: string, field: keyof MediaMeta, value: string) => {
    const updated = { ...mediaMeta, [path]: { ...mediaMeta[path], [field]: value } }
    setMediaMeta(updated)
    // Apply alt/title to <img> tags in pages whose src matches this media URL
    let updatedPages = pages
    if (field === 'alt' || field === 'title') {
      const item = mediaItems.find(m => m.path === path)
      if (item) {
        updatedPages = applyMediaMetaToPages(pages, item.url, updated[path])
        if (updatedPages !== pages) setPages(updatedPages)
      }
    }
    // Debounce save
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      saveState(messages, latestPagesRef.current, versions, updated)
    }, 1000)
  }

  const deleteMedia = async (item: MediaItem) => {
    const ok = await confirmDialog({
      title: 'Eliminare media',
      message: `"${item.name}" verrà rimosso definitivamente. L'azione non è reversibile.`,
      confirmLabel: 'Elimina',
      variant: 'danger',
    })
    if (!ok) return
    const { error } = await supabase.storage.from('project-assets').remove([item.path])
    if (error) { await alertDialog({ title: 'Errore', message: error.message, variant: 'danger' }); return }
    const newMeta = { ...mediaMeta }
    delete newMeta[item.path]
    setMediaMeta(newMeta)
    setMediaItems(prev => prev.filter(m => m.path !== item.path))
    if (selectedMedia?.path === item.path) setSelectedMedia(null)
    await saveState(messages, pages, versions, newMeta)
  }

  const copyMediaUrl = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setMediaUrlCopied(true)
    setTimeout(() => setMediaUrlCopied(false), 2000)
  }

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(2)} MB`
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

  const FRIENDLY_ERROR = 'Qualcosa è andato storto durante l\'elaborazione. Le tue modifiche al sito sono al sicuro — puoi riprovare con lo stesso messaggio.'

  const handleSend = async (e: React.FormEvent, retryOverride?: { input: string; images: string[] }) => {
    e.preventDefault()
    const effectiveInput = retryOverride?.input ?? input
    const effectiveImages = retryOverride?.images ?? attachedImages
    if ((!effectiveInput.trim() && effectiveImages.length === 0) || loading) return

    const imagesBlock = effectiveImages.length
      ? (effectiveInput.trim() ? '\n\n' : '') + effectiveImages.map(u => `Immagine allegata: ${u}`).join('\n')
      : ''
    const userContent = (effectiveInput.trim() || 'Usa queste immagini.') + imagesBlock
    const userMsg: Message = { id: `u_${Date.now()}`, role: 'user', content: userContent }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    if (!retryOverride) {
      setInput('')
      setAttachedImages([])
    }

    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    // Snapshot of the original prompt so we can offer retry later
    const retrySnapshot = { input: effectiveInput, images: effectiveImages }
    const markFailed = (errorContext?: string) => {
      console.error('[chat] failed:', errorContext)
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: FRIENDLY_ERROR, failed: true, retryInput: retrySnapshot.input, retryImages: retrySnapshot.images }
        : m))
      setLoading(false)
    }

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
      markFailed(`HTTP ${res.status}: ${error.error || ''}`)
      return
    }

    // Two response shapes: NDJSON stream (pipeline agent) or plain JSON (html/seo/etc)
    const contentType = res.headers.get('content-type') || ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any = null

    if (contentType.includes('ndjson')) {
      const reader = res.body?.getReader()
      if (!reader) { markFailed('no readable stream'); return }
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              if (msg.type === 'progress') {
                const tokenDisplay = msg.tokens > 1000 ? `${(msg.tokens / 1000).toFixed(1)}k` : msg.tokens
                const progressText = `${msg.step} • ${msg.time} • ${tokenDisplay} tokens`
                setMessages(prev => prev.map(m => m.id === assistantId
                  ? { ...m, content: progressText }
                  : m))
              } else if (msg.type === 'done') {
                result = msg.result
              } else if (msg.type === 'error') {
                throw new Error(msg.error)
              }
            } catch (e) {
              console.error('Errore parsing messaggio:', e)
            }
          }
        }
      } catch (err) {
        markFailed(`stream error: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    } else {
      try {
        result = await res.json()
      } catch (err) {
        console.error('Errore parsing JSON:', err)
      }
    }

    if (!result) {
      markFailed('empty result')
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
    if (slug === 'home') { await alertDialog(t('project.homePageError' as const, language as any)); return }
    const ok = await confirmDialog({
      title: t('project.deletePageTitle' as const, language as any),
      message: t('project.deletePageMessage' as const, language as any).replace('{slug}', slug),
      confirmLabel: t('project.deletePageButton' as const, language as any),
      variant: 'danger',
    })
    if (!ok) return
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
      if (!res.ok) { await alertDialog({ title: t('common.error' as const, language as any), message: String(result.error), variant: 'danger' }); setAddingDomain(false); return }
      setCustomDomainStatus(result.status)
      setDnsInstructions(result.message)
      setAddingDomain(false)
      if (result.status === 'pending') startPolling()
    } catch { await alertDialog({ title: t('common.error' as const, language as any), message: t('project.requestFailed' as const, language as any), variant: 'danger' }); setAddingDomain(false) }
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
    const ok = await confirmDialog({
      title: t('project.publishSiteTitle' as const, language as any),
      message: t('project.publishSiteMessage' as const, language as any).replace('{domain}', customDomain),
      confirmLabel: t('project.publishButton' as const, language as any),
    })
    if (!ok) return
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
      if (!res.ok) { await alertDialog({ title: t('common.error' as const, language as any), message: String(result.error), variant: 'danger' }); return }
      setPublishedAt(result.publishedAt)
    } catch { await alertDialog({ title: t('common.error' as const, language as any), message: t('project.publishError' as const, language as any), variant: 'danger' }) }
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
            <Link href="/projects" style={{ textDecoration: 'none', color: C.textFaint, fontSize: '1rem', display: 'flex', alignItems: 'center' }} title={t('project.allProjects' as const, language as any)}>
              ←
            </Link>
            <div>
              <p style={{ margin: 0, fontSize: '0.8375rem', fontWeight: 600, color: C.text, lineHeight: 1.2 }}>{projectName || t('projects.create' as const, language as any)}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: C.textFaint, lineHeight: 1.2 }}>{t('project.lastSaved' as const, language as any)}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <ToolbarBtn
              label="◷"
              title={t('project.versionHistory' as const, language as any)}
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
              title={chatHidden ? t('project.showChat' as const, language as any) : t('project.hideChat' as const, language as any)}
              active={chatHidden}
              onClick={() => setChatHidden(v => !v)}
            />
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
              <p style={{ fontSize: '0.9375rem', color: '#57534e', marginBottom: '0.4rem', fontWeight: 500 }}>{t('project.describeWebsite' as const, language as any)}</p>
              <p style={{ fontSize: '0.8125rem', color: C.textFaint }}>Es: &quot;{t('project.exampleWebsite' as const, language as any)}&quot;</p>
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
                <div style={{
                  width: '22px', height: '22px',
                  background: msg.failed ? '#fef3c7' : 'linear-gradient(135deg, #ff6b6b, #ffa94d)',
                  borderRadius: '6px', flexShrink: 0, marginTop: '2px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: msg.failed ? '1px solid #fcd34d' : 'none',
                }}>
                  <span style={{ color: msg.failed ? '#92400e' : 'white', fontSize: '0.6rem', fontWeight: 700 }}>
                    {msg.failed ? '!' : 'F'}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', lineHeight: '1.65', color: msg.failed ? C.textMuted : C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {stripHtmlFromChat(msg.content, language) || (loading ? (
                      <span style={{ color: C.textFaint, letterSpacing: '0.1em' }}>● ● ●</span>
                    ) : '')}
                  </div>
                  {msg.failed && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        const fakeEvent = { preventDefault: () => {} } as React.FormEvent
                        handleSend(fakeEvent, { input: msg.retryInput || '', images: msg.retryImages || [] })
                      }}
                      style={{
                        marginTop: '8px',
                        background: 'transparent', color: C.text,
                        border: `1px solid ${C.border}`, borderRadius: '7px',
                        padding: '5px 12px', fontSize: '0.78rem', fontWeight: 500,
                        cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.bg}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >↻ {t('project.retry' as const, language as any)}</button>
                  )}
                </div>
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          style={{ padding: '8px 10px 12px', flexShrink: 0, position: 'relative' }}
          onDragOver={(e) => { e.preventDefault(); if (!dragOverChat) setDragOverChat(true) }}
          onDragLeave={(e) => {
            // Only clear when leaving the container, not when entering children
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDragOverChat(false)
          }}
          onDrop={async (e) => {
            e.preventDefault()
            setDragOverChat(false)
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
            for (const file of files) await uploadImageFile(file, 'chat')
          }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          {dragOverChat && (
            <div style={{
              position: 'absolute', inset: '8px 10px 12px',
              background: 'rgba(37,99,235,0.06)',
              border: `2px dashed ${C.blue}`,
              borderRadius: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.blue, fontSize: '0.85rem', fontWeight: 500,
              pointerEvents: 'none', zIndex: 2,
            }}>
              ↓ Rilascia l&apos;immagine qui
            </div>
          )}
          <form onSubmit={handleSend}>
            <div style={{
              background: C.white,
              border: `1px solid ${dragOverChat ? C.blue : C.border}`,
              borderRadius: '12px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>
              {attachedImages.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 8px 0' }}>
                  {attachedImages.map((url, i) => (
                    <div key={url} style={{
                      position: 'relative', width: '52px', height: '52px',
                      borderRadius: '8px', overflow: 'hidden',
                      border: `1px solid ${C.border}`, flexShrink: 0,
                    }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        type="button"
                        onClick={() => setAttachedImages(prev => prev.filter((_, idx) => idx !== i))}
                        aria-label="Rimuovi immagine"
                        style={{
                          position: 'absolute', top: '2px', right: '2px',
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: 'rgba(0,0,0,0.65)', color: 'white',
                          border: 'none', cursor: 'pointer', fontSize: '0.7rem',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0, lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
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
                    if ((input.trim() || attachedImages.length > 0) && !loading) handleSend(e as unknown as React.FormEvent)
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
                    {uploading ? '⏳' : `@ ${t('project.imageButton' as const, language as any)}`}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading || (!input.trim() && attachedImages.length === 0)}
                  style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (input.trim() || attachedImages.length > 0) && !loading ? C.dark : '#d6d3d1',
                    color: 'white', border: 'none',
                    cursor: (input.trim() || attachedImages.length > 0) && !loading ? 'pointer' : 'not-allowed',
                    fontSize: '0.9rem', flexShrink: 0,
                  }}
                  title={t('project.sendButton' as const, language as any)}
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
              title={t('project.preview' as const, language as any)}
              active={viewMode === 'preview'}
              onClick={() => setViewMode('preview')}
            />
            <ToolbarBtn
              label="</>"
              title={t('project.htmlCode' as const, language as any)}
              active={viewMode === 'code'}
              onClick={() => {
                setCodeContent(activePage?.html ?? '')
                setCodeSaving('idle')
                setViewMode('code')
              }}
            />
            <ToolbarBtn
              label="✎"
              title={t('project.inlineEditor' as const, language as any)}
              active={viewMode === 'edit'}
              onClick={() => setViewMode('edit')}
            />
            <ToolbarBtn
              label="◫"
              title={t('project.mediaLibrary' as const, language as any)}
              active={viewMode === 'media'}
              onClick={() => setViewMode('media')}
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
              <button onClick={copyUrl} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: copied ? '#10b981' : C.textFaint, fontSize: '0.75rem', flexShrink: 0 }} title={t('project.copyUrl' as const, language as any)}>
                {copied ? '✓' : '⧉'}
              </button>
            )}
          </div>

          {/* Right actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ToolbarBtn label="↗" title={t('project.openNewTab' as const, language as any)} />
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
              ⚙ {t('project.settings' as const, language as any)}
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
                {publishing ? '⏳' : '🚀'} {t('project.publishButton' as const, language as any)}
              </button>
            )}
          </div>
        </div>


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
                            const ok = await confirmDialog({
                              title: 'Ripristinare versione',
                              message: 'Le modifiche attuali verranno sovrascritte (una versione di backup viene salvata automaticamente).',
                              confirmLabel: 'Ripristina',
                            })
                            if (!ok) return
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
          /* Inline editor v2 — contentEditable inside iframe with sidebar */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <EditorSidebar
              pages={pages}
              activeSlug={activeSlug}
              onPageSelect={(slug) => setActiveSlug(slug)}
            />
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
          </div>
        ) : viewMode === 'code' && activePage ? (
          /* Code editor with sidebar */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#1e1e1e' }}>
            <EditorSidebar
              pages={pages}
              activeSlug={activeSlug}
              onPageSelect={(slug) => {
                setActiveSlug(slug)
                setCodeContent(pages.find(p => p.slug === slug)?.html ?? '')
                setCodeSaving('idle')
              }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #3e3e3e', flexShrink: 0, background: '#2d2d2d' }}>
                <span style={{ fontSize: '0.75rem', color: '#858585', fontFamily: 'monospace' }}>{activePage.slug}.html</span>
              </div>
              <HtmlCodeEditor
                content={codeContent}
                onChange={(val) => {
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
                onSave={async (content) => {
                  setCodeSaving('saving')
                  const newPages = pages.map(p => p.slug === activePage.slug ? { ...p, html: content } : p)
                  setPages(newPages)
                  latestPagesRef.current = newPages
                  const newVersions = createVersion('Modifica HTML manuale', newPages, versions)
                  await saveState(messages, newPages, newVersions)
                  setCodeSaving('saved')
                  setTimeout(() => setCodeSaving('idle'), 2000)
                }}
                saving={codeSaving}
              />
            </div>
          </div>
        ) : viewMode === 'media' ? (
          /* Media Library */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{
                padding: '14px 20px', borderBottom: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, background: C.bg,
              }}>
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: C.text }}>Media</h2>
                <span style={{ fontSize: '0.78rem', color: C.textFaint }}>
                  {mediaItems.length} {mediaItems.length === 1 ? 'file' : 'file'}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{
                    background: C.dark, color: 'white', border: 'none',
                    padding: '6px 14px', fontSize: '0.78rem', fontWeight: 500,
                    borderRadius: '7px', cursor: uploading ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {uploading ? 'Carico...' : '+ Aggiungi'}
                </button>
                <input
                  type="text"
                  placeholder="Cerca..."
                  value={mediaSearch}
                  onChange={e => setMediaSearch(e.target.value)}
                  style={{
                    border: `1px solid ${C.border}`, borderRadius: '7px',
                    padding: '6px 10px', fontSize: '0.78rem', color: C.text,
                    background: C.white, outline: 'none', width: '180px',
                    fontFamily: 'inherit',
                  }}
                />
                <select
                  value={mediaSort}
                  onChange={e => setMediaSort(e.target.value as 'recent' | 'oldest' | 'name')}
                  style={{
                    border: `1px solid ${C.border}`, borderRadius: '7px',
                    padding: '6px 10px', fontSize: '0.78rem', color: C.text,
                    background: C.white, outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >
                  <option value="recent">Più recenti</option>
                  <option value="oldest">Meno recenti</option>
                  <option value="name">Nome (A-Z)</option>
                </select>
              </div>
              {/* Grid */}
              <div
                onDragOver={e => { e.preventDefault(); if (!dragOverMedia) setDragOverMedia(true) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverMedia(false) }}
                onDrop={async e => {
                  e.preventDefault(); setDragOverMedia(false)
                  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                  for (const file of files) await uploadImageFile(file, 'media')
                }}
                style={{
                  flex: 1, overflowY: 'auto', padding: '20px',
                  background: dragOverMedia ? 'rgba(37,99,235,0.04)' : 'transparent',
                  transition: 'background 0.15s',
                  position: 'relative',
                }}
              >
                {dragOverMedia && (
                  <div style={{
                    position: 'absolute', inset: '12px',
                    border: `2px dashed ${C.blue}`, borderRadius: '14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.blue, fontSize: '0.95rem', fontWeight: 500,
                    pointerEvents: 'none', zIndex: 2,
                  }}>↓ Rilascia le immagini qui</div>
                )}
                {mediaLoading ? (
                  <p style={{ color: C.textFaint, fontSize: '0.85rem', textAlign: 'center', marginTop: '40px' }}>Caricamento...</p>
                ) : mediaItems.length === 0 ? (
                  <div style={{ textAlign: 'center', marginTop: '60px', color: C.textFaint }}>
                    <div style={{ fontSize: '2rem', opacity: 0.3, marginBottom: '10px' }}>◫</div>
                    <p style={{ fontSize: '0.88rem' }}>Nessun media in questo progetto</p>
                    <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>Trascina immagini qui o usa &quot;Aggiungi&quot;</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '14px' }}>
                    {mediaItems
                      .filter(m => !mediaSearch || m.name.toLowerCase().includes(mediaSearch.toLowerCase()))
                      .sort((a, b) => {
                        if (mediaSort === 'name') return a.name.localeCompare(b.name)
                        if (mediaSort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
                        return b.createdAt.localeCompare(a.createdAt)
                      })
                      .map(item => {
                        const selected = selectedMedia?.path === item.path
                        return (
                          <button
                            key={item.path}
                            type="button"
                            onClick={() => setSelectedMedia(item)}
                            style={{
                              background: C.white, border: `2px solid ${selected ? C.blue : C.border}`,
                              borderRadius: '10px', padding: 0, cursor: 'pointer',
                              aspectRatio: '1', overflow: 'hidden',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'border-color 0.12s, transform 0.12s',
                              position: 'relative',
                            }}
                            onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = C.textFaint }}
                            onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.borderColor = C.border }}
                            // eslint-disable-next-line @next/next/no-img-element
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.url}
                              alt={mediaMeta[item.path]?.alt || item.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>
            </div>
            {/* Side panel — details */}
            {selectedMedia && (
              <div style={{
                width: '340px', flexShrink: 0, borderLeft: `1px solid ${C.border}`,
                background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.text }}>Dettagli</span>
                  <button
                    onClick={() => setSelectedMedia(null)}
                    style={{ background: 'transparent', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: C.textFaint, padding: '0 4px' }}
                  >×</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
                  <div style={{
                    background: C.white, borderRadius: '10px', overflow: 'hidden',
                    border: `1px solid ${C.border}`, marginBottom: '14px',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selectedMedia.url} alt={mediaMeta[selectedMedia.path]?.alt || selectedMedia.name} style={{ width: '100%', display: 'block' }} />
                  </div>
                  <div style={{ fontSize: '0.76rem', color: C.textMuted, lineHeight: '1.7', marginBottom: '14px' }}>
                    <div><strong style={{ color: C.text }}>Nome:</strong> {selectedMedia.name}</div>
                    <div><strong style={{ color: C.text }}>Peso:</strong> {formatBytes(selectedMedia.size)}</div>
                    <div><strong style={{ color: C.text }}>Caricato:</strong> {selectedMedia.createdAt ? new Date(selectedMedia.createdAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</div>
                  </div>
                  {(['alt', 'title', 'caption', 'description'] as const).map(field => {
                    const labels = { alt: 'Testo alternativo', title: 'Titolo', caption: 'Didascalia', description: 'Descrizione' }
                    const isLong = field === 'caption' || field === 'description'
                    const value = mediaMeta[selectedMedia.path]?.[field] || ''
                    return (
                      <div key={field} style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', fontSize: '0.67rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                          {labels[field]}
                        </label>
                        {isLong ? (
                          <textarea
                            value={value}
                            onChange={e => updateMediaMeta(selectedMedia.path, field, e.target.value)}
                            rows={2}
                            style={{
                              width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px',
                              padding: '7px 9px', fontSize: '0.8rem', color: C.text,
                              background: C.white, fontFamily: 'inherit', resize: 'vertical',
                              outline: 'none', boxSizing: 'border-box' as const,
                            }}
                          />
                        ) : (
                          <input
                            type="text"
                            value={value}
                            onChange={e => updateMediaMeta(selectedMedia.path, field, e.target.value)}
                            style={{
                              width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px',
                              padding: '7px 9px', fontSize: '0.8rem', color: C.text,
                              background: C.white, fontFamily: 'inherit',
                              outline: 'none', boxSizing: 'border-box' as const,
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                  <div style={{ marginTop: '14px' }}>
                    <label style={{ display: 'block', fontSize: '0.67rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>URL</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="text"
                        readOnly
                        value={selectedMedia.url}
                        style={{
                          flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px',
                          padding: '7px 9px', fontSize: '0.75rem', color: C.textMuted,
                          background: C.white, fontFamily: 'monospace',
                          outline: 'none', boxSizing: 'border-box' as const,
                        }}
                      />
                      <button
                        onClick={() => copyMediaUrl(selectedMedia.url)}
                        style={{
                          background: C.white, border: `1px solid ${C.border}`, borderRadius: '7px',
                          padding: '7px 12px', fontSize: '0.76rem', cursor: 'pointer',
                          color: C.text, fontFamily: 'inherit', whiteSpace: 'nowrap',
                        }}
                      >{mediaUrlCopied ? '✓' : 'Copia'}</button>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMedia(selectedMedia)}
                    style={{
                      marginTop: '20px', width: '100%',
                      background: 'transparent', color: '#dc2626',
                      border: '1px solid #fca5a5', borderRadius: '7px',
                      padding: '8px', fontSize: '0.8rem', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >Elimina definitivamente</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Preview mode with sidebar */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <EditorSidebar
              pages={pages}
              activeSlug={activeSlug}
              onPageSelect={(slug) => setActiveSlug(slug)}
            />
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {activePage ? (
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
