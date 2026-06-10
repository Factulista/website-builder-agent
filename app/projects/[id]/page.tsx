'use client'

import React, { useState, use, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { suggestKeywordsForArticle, type SeoKeyword } from '../../../lib/keyword-suggester'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { confirmDialog, alertDialog } from '../../../lib/dialog'
import { EditorSidebar } from '../../../components/EditorSidebar'
import { HtmlCodeEditor } from '../../../components/HtmlCodeEditor'
import { StructurePanel } from '../../../components/StructurePanel'

// Dynamic import — ComponentCanvas viene scaricato solo quando l'utente clicca "⊞ Blocco"
// Questo evita di aggiungere il suo peso al bundle iniziale della pagina (già 450 kB)
const ComponentCanvas = dynamic(
  () => import('../../../components/ComponentCanvas').then(m => ({ default: m.ComponentCanvas })),
  { ssr: false, loading: () => null }
)
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'
import { analyzeAllPages, getAggregateScore, scoreColor, type PageAnalysis, type CheckResult } from '../../../lib/seo/analyzer'
import { SEO_CHECKS, SEO_GROUPS, type CheckId } from '../../../lib/seo/checks'
import type { Page } from '../../../lib/types'
import { BLOG_POST_CONTENT_CSS, buildBlogPostPage, type Post as BlogServePost } from '../../../lib/blog-serve'
import { syncSharedCssWithDesignSystem, mergeRootVars, type DesignSystem as LibDesignSystem } from '../../../lib/design-system'
import { splitHtmlIntoBlocks } from '../../../lib/agents/block-splitter'
import { compileSeo, formatSeoReport } from '../../../lib/seo-compiler'
import { buildSharedFrameCss, FRAME_GLOBAL_FIX } from '../../../lib/shared-frame'
import { renderComponentById } from '../../../lib/components/index'

/** Format HTML with indentation for the code editor. Also fixes &quot; inside style attributes. */
function prettifyHtml(raw: string): string {
  // Fix &quot; inside style attributes → real double quotes
  let html = raw.replace(/(<[^>]+style="[^"]*?)&quot;([^"]*?")/g, '$1"$2')
  html = html.replace(/&quot;/g, '"')
  // Collapse all whitespace between tags first
  html = html.replace(/>\s+</g, '><').trim()

  const VOID    = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
  const INLINE  = new Set(['a','abbr','b','bdo','big','br','cite','code','dfn','em','i','img','input','kbd','label','map','output','q','s','samp','select','small','span','strong','sub','sup','textarea','time','tt','u','var'])
  const PRE     = new Set(['script','style','pre','textarea'])

  const tab = '  '
  let indent = 0
  let result = ''
  let inPre = false

  // Tokenise: tags + text nodes
  const tokens = html.split(/(<[^>]+>|<!--[\s\S]*?-->)/g)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    if (token.startsWith('<!--')) {
      result += '\n' + tab.repeat(indent) + token
      continue
    }

    if (token.startsWith('<')) {
      const tag = (token.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/) ?? [])[1]?.toLowerCase() ?? ''
      const isClose    = token.startsWith('</')
      const isSelfClose = token.endsWith('/>') || VOID.has(tag)
      const isInline   = INLINE.has(tag)
      const isPre      = PRE.has(tag)

      if (isPre && !isClose) inPre = true
      if (isPre &&  isClose) inPre = false

      if (inPre || isInline) {
        result += token
        continue
      }

      if (isClose) {
        // Check if the previous output already has content after the last newline
        // → if closing tag immediately follows text on same indent level, put it inline
        const lastNewline = result.lastIndexOf('\n')
        const lastLine = result.slice(lastNewline + 1)
        const lastLineIndent = lastLine.match(/^(\s*)/)?.[1] ?? ''
        indent = Math.max(0, indent - 1)
        // If the last line is plain text (no tags) at child indent → collapse to same line
        if (!lastLine.trimStart().startsWith('<') && lastLineIndent.length > indent * tab.length) {
          result += token  // inline closing tag after text
        } else {
          result += '\n' + tab.repeat(indent) + token
        }
        continue
      }

      if (isSelfClose) {
        result += '\n' + tab.repeat(indent) + token
        continue
      }

      // Opening block tag — peek ahead: does it contain ONLY text (no child tags) before closing?
      // Pattern: tokens[i] = <tag>, tokens[i+1] = text, tokens[i+2] = </tag>
      const nextText  = tokens[i + 1] ?? ''
      const nextClose = tokens[i + 2] ?? ''
      const closeTag  = `</${tag}>`
      const hasOnlyText = nextClose.toLowerCase() === closeTag && !nextText.startsWith('<')

      if (hasOnlyText && nextText.trim()) {
        // Render as single line: <tag>text</tag>
        result += '\n' + tab.repeat(indent) + token + nextText.trim() + closeTag
        i += 2 // skip text + closing tag tokens
      } else {
        result += '\n' + tab.repeat(indent) + token
        indent++
      }
    } else {
      // Text node
      const text = token.trim()
      if (!text) continue
      result += inPre ? token : '\n' + tab.repeat(indent) + text
    }
  }

  return result.trim()
}

type Message = { id: string; role: 'user' | 'assistant'; content: string; images?: string[]; progressSteps?: { step: string; time: string }[]; failed?: boolean; retryInput?: string; retryImages?: string[]; timestamp?: string }
// Versions live in their own `project_versions` table (not in site_config) to keep
// the hot-path save payload small. `pages` is loaded lazily — only on restore — so
// the history list itself stays lightweight.
type Version = { id: string; timestamp: string; summary: string; pages?: Page[] }
type MediaMeta = { alt?: string; title?: string; caption?: string; description?: string }
type MediaItem = { path: string; name: string; size: number; createdAt: string; url: string }

/** Converts a title to a URL-safe slug: lowercase, no accents, words joined by "-" */
function slugify(text: string): string {
  return text
    .normalize('NFD')                        // decompose accented chars (è → e + ̀)
    .replace(/[̀-ͯ]/g, '')         // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')           // keep only letters, digits, spaces, hyphens
    .trim()
    .replace(/[\s]+/g, '-')                  // spaces → hyphens
    .replace(/-+/g, '-')                     // collapse multiple hyphens
    .replace(/^-|-$/g, '')                   // trim leading/trailing hyphens
}

function buildInlineEditScript(pages: { slug: string; name: string }[]) {
  // Build the pages data to embed in the script
  const pagesJson = JSON.stringify(
    pages.map(p => ({ slug: p.slug, name: p.name, href: p.slug === 'home' ? './' : `./${p.slug}` }))
  )
  return buildInlineEditScriptTemplate(pagesJson)
}

const INLINE_EDIT_SCRIPT = buildInlineEditScript([]) // fallback, overridden at inject time

function buildInlineEditScriptTemplate(pagesJson: string) { return `(function(){
  var FACT_PAGES=${pagesJson};`
  + `
  var SKIP=new Set(['SCRIPT','STYLE','HEAD','META','LINK','IMG','VIDEO','AUDIO','IFRAME','INPUT','TEXTAREA','SELECT','CANVAS','NOSCRIPT','OBJECT','EMBED','SVG']);

  // Freeze all interactions — re-enable only on editable elements and editor UI
  var globalStyle=document.createElement('style');
  globalStyle.id='fact-edit-global';
  globalStyle.textContent=
    '*{pointer-events:none!important;user-select:none!important;-webkit-user-select:none!important;'+
    'transition:none!important;animation-play-state:paused!important;}'+
    '[data-fact-edit]{pointer-events:auto!important;user-select:text!important;'+
    '-webkit-user-select:text!important;cursor:text!important;}'+
    '#fact-ctx-menu,#fact-ctx-menu *,#fact-link-overlay,#fact-link-overlay *'+
    '{pointer-events:auto!important;user-select:auto!important;-webkit-user-select:auto!important;}';
  document.head.appendChild(globalStyle);

  // ── Attach contenteditable ──────────────────────────────────────────────────
  function attach(el){
    if(el.getAttribute('contenteditable')==='true') return;
    el.contentEditable='true';
    el.dataset.factEdit='1';
    el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();});
    el.addEventListener('mouseenter',function(){
      if(document.activeElement!==el){el.style.outline='2px dashed rgba(37,99,235,0.5)';el.style.outlineOffset='3px';el.style.borderRadius='3px';}
    });
    el.addEventListener('mouseleave',function(){
      if(document.activeElement!==el){el.style.outline='';el.style.outlineOffset='';}
    });
    el.addEventListener('focus',function(){el.style.outline='2px solid #2563eb';el.style.outlineOffset='3px';el.style.borderRadius='3px';});
    el.addEventListener('blur',function(){el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';});
    el.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&/^(H[1-6]|BUTTON|A)$/.test(el.tagName)){e.preventDefault();}
    });
  }

  function run(){
    var walker=document.createTreeWalker(document.body,4);
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

  // ── Save helper ────────────────────────────────────────────────────────────
  function triggerSave(){
    setTimeout(function(){
      var clone=document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-fact-edit]').forEach(function(el){
        el.removeAttribute('contenteditable');el.removeAttribute('data-fact-edit');
        el.style.outline='';el.style.outlineOffset='';el.style.borderRadius='';
      });
      // Remove editor-only elements (base tags, font preloads, UI overlays)
      clone.querySelectorAll('[data-fact-editor],base').forEach(function(el){el.remove();});
      ['#fact-edit-global','#fact-edit-script','#fact-edit-marker','#fact-ctx-menu','#fact-link-overlay'].forEach(function(sel){
        var el=clone.querySelector(sel);if(el)el.remove();
      });
      // Reset runtime "open" state on interactive widgets (mega-menu / dropdowns /
      // accordions) before serializing. Otherwise, if a save fires while one is
      // hovered/open, data-open="true" gets baked into the saved HTML and the
      // CSS rule [data-open="true"]{display:grid} leaves it stuck open on reload.
      clone.querySelectorAll('[data-open]').forEach(function(el){el.setAttribute('data-open','false');});
      clone.querySelectorAll('[aria-expanded="true"]').forEach(function(el){el.setAttribute('aria-expanded','false');});
      // Normalize mobile-menu toggle class: standardize on "open" (some agent-generated
      // pages use "active" instead, causing inconsistency across pages and broken toggles
      // when nav CSS from home — which uses "open" — is synced to other pages).
      clone.querySelectorAll('.mobile-menu.active').forEach(function(el){
        el.classList.remove('active');
        // Don't add 'open' — just ensure it's closed on save. The hamburger script
        // re-opens on user interaction.
      });
      // Also normalize hamburger script references: rewrite script text to use 'open'
      clone.querySelectorAll('script').forEach(function(s){
        var t=s.textContent||'';
        if(t.includes('mobile-menu') && t.includes("'active'") && !t.includes("'open'")){
          s.textContent=t.replace(/classList\.toggle\('active'\)/g,"classList.toggle('open')")
                         .replace(/classList\.contains\('active'\)/g,"classList.contains('open')")
                         .replace(/classList\.remove\('active'\)/g,"classList.remove('open')")
                         .replace(/\.mobile-menu\.active/g,'.mobile-menu.open');
        }
      });
      // Strip injected runtime scripts that are re-added on every load by injectBase.
      // Without this, each save cycle appends another copy → after N saves the page
      // has N copies of scroll-to-text, carousel, etc. listeners all running in parallel.
      clone.querySelectorAll('script').forEach(function(s){
        var t=s.textContent||'';
        if(t.includes('scroll-to-text')||t.includes('fact-edit')||t.includes('html-change')){s.remove();}
      });
      // Hoist component inline <style> tags to <head> (deduplication).
      // Components like mega-menu inject a <style> inside their <li>.
      // This means every page has the same CSS duplicated inside the nav.
      // Moving it to <head> once: reduces HTML size, prevents duplicates,
      // and makes what the AI agent reads for editing much cleaner.
      var compHead = clone.querySelector('head');
      if (compHead) {
        var seenCss = new Set();
        clone.querySelectorAll('[data-comp] style, .comp-nfd style, .comp-fg style, .comp-hero style, .comp-cta style').forEach(function(s){
          var css = (s.textContent||'').trim();
          if (!css) { s.remove(); return; }
          if (!seenCss.has(css)) {
            seenCss.add(css);
            var tag = document.createElement('style');
            tag.setAttribute('data-component-css','true');
            tag.textContent = css;
            compHead.appendChild(tag);
          }
          s.remove();
        });
      }
      var html='<!DOCTYPE html>\\n'+clone.outerHTML;
      var snippet=html.length>300?html.slice(0,300)+'…':html;
      console.log('[iframe] triggerSave sending html-change, length:',html.length,'preview:',snippet);
      window.parent.postMessage({type:'html-change',html:html},'*');
    },80);
  }

  // ── Auto-save on text input ────────────────────────────────────────────────
  var saveTimer;
  document.addEventListener('input',function(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(triggerSave,200);
  });

  // ── Selection helpers ──────────────────────────────────────────────────────
  var savedRange=null;
  function saveSelection(){
    var sel=window.getSelection();
    if(sel&&sel.rangeCount>0) savedRange=sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection(){
    if(!savedRange) return;
    var sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function getAnchorLink(){
    var sel=window.getSelection();
    if(!sel||!sel.anchorNode) return null;
    var node=sel.anchorNode;
    while(node&&node!==document.body){
      if(node.tagName==='A') return node;
      node=node.parentElement;
    }
    return null;
  }
  function getTableCell(evTarget){
    // First try: walk up from the right-click target (works even without a selection)
    var node=evTarget||null;
    while(node&&node!==document.body){
      if(node.tagName==='TD'||node.tagName==='TH') return node;
      node=node.parentElement;
    }
    // Fallback: walk up from the selection anchor node
    var sel=window.getSelection();
    if(!sel||!sel.anchorNode) return null;
    node=sel.anchorNode;
    while(node&&node!==document.body){
      if(node.tagName==='TD'||node.tagName==='TH') return node;
      node=node.parentElement;
    }
    return null;
  }

  // ── Table operations ──────────────────────────────────────────────────────
  function tableAddRow(cell,after){
    var row=cell.parentElement;
    var newRow=document.createElement('tr');
    newRow.style.cssText=row.style.cssText||'';
    var isEven=(row.rowIndex%2===0);
    var bg=isEven?'':'#f9fafb';
    for(var i=0;i<row.cells.length;i++){
      var ref=row.cells[i];
      var c=document.createElement(ref.tagName.toLowerCase());
      c.style.cssText=ref.style.cssText||'';
      c.innerHTML='&nbsp;';
      if(bg&&ref.tagName==='TD') c.style.background=bg;
      newRow.appendChild(c);
    }
    if(after) row.insertAdjacentElement('afterend',newRow);
    else row.insertAdjacentElement('beforebegin',newRow);
    triggerSave();
  }
  function tableDeleteRow(cell){
    var row=cell.parentElement;
    var table=row.closest?row.closest('table'):null;
    if(!table) return;
    if(table.rows.length<=1) return;
    row.remove();
    triggerSave();
  }
  function tableAddCol(cell,after){
    var colIdx=cell.cellIndex;
    var table=cell.closest?cell.closest('table'):null;
    if(!table) return;
    for(var r=0;r<table.rows.length;r++){
      var row=table.rows[r];
      var ref=row.cells[colIdx];
      if(!ref) continue;
      var newCell=document.createElement(ref.tagName.toLowerCase());
      newCell.style.cssText=ref.style.cssText||'';
      newCell.innerHTML= (ref.tagName==='TH')?'<strong>Colonna</strong>':'&nbsp;';
      if(after){
        if(row.cells[colIdx+1]) row.insertBefore(newCell,row.cells[colIdx+1]);
        else row.appendChild(newCell);
      } else {
        row.insertBefore(newCell,ref);
      }
    }
    triggerSave();
  }
  function tableDeleteCol(cell){
    var colIdx=cell.cellIndex;
    var table=cell.closest?cell.closest('table'):null;
    if(!table) return;
    if(table.rows[0]&&table.rows[0].cells.length<=1) return;
    for(var r=0;r<table.rows.length;r++){
      var c=table.rows[r].cells[colIdx];
      if(c) c.remove();
    }
    triggerSave();
  }

  // ── Context menu ──────────────────────────────────────────────────────────
  var ctxMenu=null;
  function removeCtxMenu(){if(ctxMenu){ctxMenu.remove();ctxMenu=null;}}

  document.addEventListener('contextmenu',function(e){
    // Only inside editable areas
    var t=e.target;
    while(t&&t!==document.body){
      if((t.dataset&&t.dataset.factEdit)||t.tagName==='A') break;
      t=t.parentElement;
    }
    if(!t||t===document.body) return;

    e.preventDefault();
    removeCtxMenu();
    saveSelection();
    var anchorEl=getAnchorLink();

    var menu=document.createElement('div');
    menu.id='fact-ctx-menu';
    menu.style.cssText='position:fixed;z-index:99999;background:#fff;border:1px solid #e2e8f0;'+
      'border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.13);padding:5px;min-width:190px;'+
      'font-family:system-ui,sans-serif;font-size:13px;';
    menu.style.left=Math.min(e.clientX,window.innerWidth-210)+'px';
    menu.style.top=Math.min(e.clientY,window.innerHeight-430)+'px';

    function item(icon,label,danger,onClick){
      var d=document.createElement('div');
      d.style.cssText='padding:8px 12px;cursor:pointer;border-radius:6px;display:flex;'+
        'align-items:center;gap:9px;color:'+(danger?'#dc2626':'#1a1a1a')+';';
      d.innerHTML='<span style="font-size:15px;width:18px;text-align:center">'+icon+'</span><span>'+label+'</span>';
      d.onmouseenter=function(){d.style.background=danger?'#fef2f2':'#f1f5f9';};
      d.onmouseleave=function(){d.style.background='transparent';};
      d.addEventListener('mousedown',function(e){e.preventDefault();removeCtxMenu();onClick();});
      return d;
    }
    function sep(){var s=document.createElement('div');s.style.cssText='height:1px;background:#f1f5f9;margin:4px 0;';return s;}

    // ── Clipboard ──────────────────────────────────────────────────────────────
    menu.appendChild(item('✂️','Taglia',false,function(){
      restoreSelection();
      document.execCommand('cut');
    }));
    menu.appendChild(item('📋','Copia',false,function(){
      restoreSelection();
      document.execCommand('copy');
    }));
    menu.appendChild(item('📌','Incolla',false,function(){
      restoreSelection();
      var el=document.activeElement;
      if(navigator.clipboard&&navigator.clipboard.readText){
        navigator.clipboard.readText().then(function(text){
          if(!text) return;
          var node=el;
          while(node&&!node.isContentEditable) node=node.parentElement;
          if(node){node.focus();restoreSelection();document.execCommand('insertText',false,text);triggerSave();}
        }).catch(function(){document.execCommand('paste');triggerSave();});
      } else {
        document.execCommand('paste');
        triggerSave();
      }
    }));
    menu.appendChild(item('📄','Incolla senza formattazione',false,function(){
      restoreSelection();
      var el=document.activeElement;
      function pasteAsPlain(text){
        var node=el;
        while(node&&!node.isContentEditable) node=node.parentElement;
        if(node){node.focus();restoreSelection();document.execCommand('insertText',false,text);triggerSave();}
      }
      if(navigator.clipboard&&navigator.clipboard.readText){
        navigator.clipboard.readText().then(pasteAsPlain).catch(function(){
          // fallback: ask user to paste, strip tags from pasted HTML
          var tmp=document.createElement('div');
          tmp.contentEditable='true';
          tmp.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;';
          document.body.appendChild(tmp);
          tmp.focus();
          document.execCommand('paste');
          var plain=tmp.innerText||'';
          tmp.remove();
          pasteAsPlain(plain);
        });
      } else {
        document.execCommand('paste');
        triggerSave();
      }
    }));

    menu.appendChild(sep());

    // ── Link actions ───────────────────────────────────────────────────────────
    menu.appendChild(item('🔗', anchorEl?'Modifica link':'Inserisci link', false, function(){
      // If editing an existing anchor, ensure savedRange is inside it
      if(anchorEl){
        var r=document.createRange();
        r.selectNodeContents(anchorEl);
        savedRange=r;
      }
      showLinkDialog(anchorEl?anchorEl.getAttribute('href'):null);
    }));
    if(anchorEl){
      menu.appendChild(item('✂️','Rimuovi link',true,function(){
        // For unlink: select the whole anchor content first
        var r=document.createRange();
        r.selectNodeContents(anchorEl);
        savedRange=r;
        var node=anchorEl;
        while(node&&!node.isContentEditable) node=node.parentElement;
        if(node) node.focus();
        restoreSelection();
        document.execCommand('unlink');
        triggerSave();
      }));
    }

    menu.appendChild(sep());

    // ── Text formatting ────────────────────────────────────────────────────────
    menu.appendChild(item('𝐁','Grassetto',false,function(){restoreSelection();document.execCommand('bold');triggerSave();}));
    menu.appendChild(item('𝐼','Corsivo',false,function(){restoreSelection();document.execCommand('italic');triggerSave();}));
    menu.appendChild(item('U̲','Sottolineato',false,function(){restoreSelection();document.execCommand('underline');triggerSave();}));
    menu.appendChild(item('S̶','Barrato',false,function(){restoreSelection();document.execCommand('strikeThrough');triggerSave();}));

    menu.appendChild(sep());

    // ── Alignment ──────────────────────────────────────────────────────────────
    menu.appendChild(item('⬅','Allinea a sinistra',false,function(){restoreSelection();document.execCommand('justifyLeft');triggerSave();}));
    menu.appendChild(item('↔','Allinea al centro',false,function(){restoreSelection();document.execCommand('justifyCenter');triggerSave();}));
    menu.appendChild(item('➡','Allinea a destra',false,function(){restoreSelection();document.execCommand('justifyRight');triggerSave();}));

    // ── Table operations (only when inside a table cell) ───────────────────────
    var tCell=getTableCell(e.target);
    if(tCell){
      menu.appendChild(sep());
      var tHdr=document.createElement('div');
      tHdr.style.cssText='padding:3px 12px 5px;font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;';
      tHdr.textContent='Tabella';
      menu.appendChild(tHdr);
      menu.appendChild(item('⬆','Aggiungi riga sopra',false,function(){tableAddRow(tCell,false);}));
      menu.appendChild(item('⬇','Aggiungi riga sotto',false,function(){tableAddRow(tCell,true);}));
      menu.appendChild(item('🗑','Elimina riga',true,function(){tableDeleteRow(tCell);}));
      menu.appendChild(sep());
      menu.appendChild(item('⬅','Aggiungi colonna a sinistra',false,function(){tableAddCol(tCell,false);}));
      menu.appendChild(item('➡','Aggiungi colonna a destra',false,function(){tableAddCol(tCell,true);}));
      menu.appendChild(item('🗑','Elimina colonna',true,function(){tableDeleteCol(tCell);}));
    }

    document.body.appendChild(menu);
    ctxMenu=menu;
  });

  document.addEventListener('click',function(e){if(ctxMenu&&!ctxMenu.contains(e.target))removeCtxMenu();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')removeCtxMenu();});

  // ── Link dialog ────────────────────────────────────────────────────────────
  function showLinkDialog(currentHref){
    var overlay=document.createElement('div');
    overlay.id='fact-link-overlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.28);'+
      'display:flex;align-items:center;justify-content:center;';

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:13px;padding:22px 22px 18px;width:380px;'+
      'box-shadow:0 8px 40px rgba(0,0,0,0.18);font-family:system-ui,sans-serif;';

    box.innerHTML=
      '<p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#1a1a1a">Inserisci link</p>'+
      '<p style="margin:0 0 12px;font-size:12px;color:#6b7280">'+
        'Scrivi <code style="background:#f1f5f9;padding:1px 5px;border-radius:4px">/</code> per pagine interne &nbsp;·&nbsp;'+
        '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px">https://</code> per link esterni'+
      '</p>'+
      '<div style="position:relative">'+
        '<input id="fact-link-input" type="text" placeholder="/ oppure https://…" autocomplete="off" '+
          'style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #cbd5e1;'+
          'border-radius:8px;font-size:14px;font-family:monospace;outline:none;color:#1a1a1a;" '+
          'value="'+(currentHref||'')+'">'+
        '<div id="fact-link-dd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;'+
          'background:#fff;border:1px solid #e2e8f0;border-radius:8px;'+
          'box-shadow:0 4px 16px rgba(0,0,0,0.1);z-index:100001;overflow-y:auto;max-height:220px;"></div>'+
      '</div>'+
      '<p id="fact-link-hint" style="margin:6px 0 0;font-size:11px;min-height:16px;color:#6b7280"></p>'+
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">'+
        '<button id="fact-link-cancel" style="padding:8px 18px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-family:inherit;color:#374151;">Annulla</button>'+
        '<button id="fact-link-ok" style="padding:8px 18px;border:none;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;">Conferma</button>'+
      '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var input=box.querySelector('#fact-link-input');
    var hint=box.querySelector('#fact-link-hint');
    var dd=box.querySelector('#fact-link-dd');
    setTimeout(function(){input.focus();if(currentHref)input.select();},40);

    // ── Suggestions dropdown ────────────────────────────────────────────────
    function renderDD(filter){
      dd.innerHTML='';
      var q=(filter||'').toLowerCase().replace(/^\\.?\\//,'');
      var matches=FACT_PAGES.filter(function(p){
        return !q||p.name.toLowerCase().includes(q)||p.slug.toLowerCase().includes(q);
      });
      if(!matches.length){dd.style.display='none';return;}
      matches.forEach(function(p,i){
        var row=document.createElement('div');
        row.style.cssText='padding:9px 13px;cursor:pointer;display:flex;align-items:center;'+
          'justify-content:space-between;font-size:13px;'+
          (i<matches.length-1?'border-bottom:1px solid #f1f5f9;':'');
        row.innerHTML=
          '<code style="font-size:13px;color:#2563eb;font-family:monospace">'+p.href+'</code>'+
          '<span style="font-size:11px;color:#9ca3af;margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">'+p.name+'</span>';
        row.onmouseenter=function(){row.style.background='#f8fafc';};
        row.onmouseleave=function(){row.style.background='';};
        row.addEventListener('mousedown',function(e){
          e.preventDefault();
          input.value=p.href;
          dd.style.display='none';
          updateHint(p.href);
        });
        dd.appendChild(row);
      });
      dd.style.display='block';
    }

    function updateHint(v){
      if(!v){hint.textContent='';return;}
      if(/^https?:\\/\\//.test(v)){hint.style.color='#059669';hint.textContent='✓ Link esterno';}
      else if(v==='./'){hint.style.color='#2563eb';hint.textContent='✓ Home page';}
      else if(/^\\.?\\//.test(v)){hint.style.color='#2563eb';hint.textContent='✓ Pagina interna';}
      else if(v.startsWith('#')){hint.style.color='#7c3aed';hint.textContent='✓ Ancora interna';}
      else{hint.style.color='#dc2626';hint.textContent='⚠ Usa / per pagine interne o https:// per esterni';}
    }

    input.addEventListener('input',function(){
      var v=input.value;
      updateHint(v.trim());
      var isInternal=v===''||v==='/'||v==='./'||(/^\\.?\\//.test(v)&&!v.startsWith('http'));
      if(isInternal) renderDD(v); else dd.style.display='none';
    });

    // Show all pages on first focus if field is empty
    input.addEventListener('focus',function(){
      if(!input.value||input.value==='/'||input.value==='./') renderDD('');
    });
    input.addEventListener('blur',function(){
      setTimeout(function(){dd.style.display='none';},160);
    });

    // Keyboard navigation in dropdown
    var ddIdx=-1;
    input.addEventListener('keydown',function(e){
      var rows=dd.querySelectorAll('div');
      if(e.key==='ArrowDown'){e.preventDefault();ddIdx=Math.min(ddIdx+1,rows.length-1);rows.forEach(function(r,i){r.style.background=i===ddIdx?'#eff6ff':'';});}
      else if(e.key==='ArrowUp'){e.preventDefault();ddIdx=Math.max(ddIdx-1,0);rows.forEach(function(r,i){r.style.background=i===ddIdx?'#eff6ff':'';});}
      else if(e.key==='Tab'&&dd.style.display!=='none'&&ddIdx>=0){e.preventDefault();rows[ddIdx].dispatchEvent(new MouseEvent('mousedown'));}
    });

    function confirm(){
      var url=input.value.trim();
      if(!url){overlay.remove();return;}
      overlay.remove();

      // Critical: refocus the contenteditable that owned the selection
      // before calling execCommand — otherwise the command acts on the
      // input field (which is not contenteditable) and does nothing.
      if(savedRange){
        var node=savedRange.startContainer;
        var el=node.nodeType===3?node.parentElement:node;
        while(el&&!el.isContentEditable) el=el.parentElement;
        if(el) el.focus();
      }

      restoreSelection();

      // If editing an existing <a>, update its href directly instead of
      // wrapping again (execCommand('createLink') can double-wrap)
      var existingAnchor=getAnchorLink();
      if(existingAnchor){
        existingAnchor.setAttribute('href',url);
      } else {
        // Bail if selection collapsed — nothing to wrap
        var sel=window.getSelection();
        if(!sel||sel.isCollapsed) return;
        document.execCommand('createLink',false,url);
      }

      // Prevent link navigation while in edit mode
      document.querySelectorAll('a[href]').forEach(function(a){
        if(!a.__factLinkBound){
          a.__factLinkBound=true;
          a.addEventListener('click',function(e){e.preventDefault();});
        }
      });
      triggerSave();
    }

    box.querySelector('#fact-link-ok').addEventListener('click',confirm);
    box.querySelector('#fact-link-cancel').addEventListener('click',function(){overlay.remove();});
    input.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();confirm();}
      if(e.key==='Escape'){e.preventDefault();overlay.remove();}
    });
    overlay.addEventListener('mousedown',function(e){if(e.target===overlay)overlay.remove();});
  }

  // ── Toolbar postMessage bridge ─────────────────────────────────────────────
  var colorSavedRange=null;
  window.addEventListener('message',function(e){
    if(!e.data||typeof e.data!=='object') return;
    if(e.data.type==='fact-save-sel'){
      var csel=window.getSelection();
      if(csel&&csel.rangeCount>0) colorSavedRange=csel.getRangeAt(0).cloneRange();
    }
    if(e.data.type==='fact-format'){
      var cmd=e.data.cmd,val=e.data.val||null;
      console.log('[iframe] fact-format', cmd, val);
      // Restore selection if it was saved before opening a native picker (e.g. color input)
      if(colorSavedRange){
        var csel2=window.getSelection();
        if(csel2){csel2.removeAllRanges();csel2.addRange(colorSavedRange);}
        colorSavedRange=null;
      }
      // Ensure iframe document is focused so execCommand applies.
      // For undo/redo, focus the contenteditable element specifically — the
      // browser maintains the undo stack per editable element, and undo from
      // an unfocused element can leave dangling new content while restoring
      // the old (the "Resumen rápidoResumen rápido" duplication bug).
      try{
        if(cmd==='undo'||cmd==='redo'){
          var ed=document.querySelector('[contenteditable="true"], [contenteditable=""]');
          if(ed&&typeof ed.focus==='function') ed.focus();
        } else {
          window.focus();
        }
      }catch(_){}
      // Enable CSS-based styling so we get <span style="..."> instead of deprecated tags
      if(cmd==='fontName'||cmd==='foreColor'){document.execCommand('styleWithCSS',false,'true');}
      // Special-case: formatBlock on an LI is invalid HTML. First exit the list,
      // then apply the requested block type.
      if(cmd==='formatBlock'){
        var fsel=window.getSelection();
        if(fsel&&fsel.rangeCount){
          var fnode=fsel.getRangeAt(0).startContainer;
          var fel=fnode.nodeType===3?fnode.parentElement:fnode;
          var inUl=false,inOl=false;
          while(fel&&fel!==document.body){
            if(fel.tagName==='UL'){inUl=true;break;}
            if(fel.tagName==='OL'){inOl=true;break;}
            fel=fel.parentElement;
          }
          if(inUl) document.execCommand('insertUnorderedList',false,null);
          else if(inOl) document.execCommand('insertOrderedList',false,null);
        }
      }
      // Fix: after inserting a list, unwrap any heading elements that ended up
      // inside <li> tags. When execCommand('insertUnorderedList') is applied to
      // selected heading text, browsers create <ul><li><h1>...</h1></li></ul>.
      // This leaves the heading styling inside the list, making items look like
      // giant titles. We strip the heading wrapper and keep its text content.
      if(cmd==='insertUnorderedList'||cmd==='insertOrderedList'){
        document.execCommand(cmd,false,val);
        // After list creation, unwrap block-level wrappers (headings, paragraphs)
        // from inside <li> elements. Browsers often create <li><p>text</p></li> or
        // <li><h1>text</h1></li> when wrapping block content. These cause:
        //  - <p> wrapper: adds bottom margin → huge gaps between items
        //  - <h*> wrapper: makes items and list markers appear in heading size
        // Only unwrap when the <li> has exactly one block child and no other text,
        // so we don't destroy multi-paragraph list items.
        document.querySelectorAll('li').forEach(function(li){
          var children=Array.prototype.slice.call(li.childNodes);
          var blockChild=null,hasOther=false;
          for(var i=0;i<children.length;i++){
            var ch=children[i];
            if(ch.nodeType===3&&ch.textContent.trim()){hasOther=true;break;}
            if(ch.nodeType===1){
              if(/^(P|H[1-6])$/.test(ch.tagName)){
                if(blockChild){hasOther=true;break;}
                blockChild=ch;
              } else {hasOther=true;break;}
            }
          }
          if(blockChild&&!hasOther){
            var frag=document.createDocumentFragment();
            while(blockChild.firstChild) frag.appendChild(blockChild.firstChild);
            li.replaceChild(frag,blockChild);
          }
        });
        triggerSave();
        return;
      }
      document.execCommand(cmd,false,val);
      triggerSave();
    }
    if(e.data.type==='fact-fontsize'){
      var pt=e.data.pt;
      if(colorSavedRange){
        var csel3=window.getSelection();
        if(csel3){csel3.removeAllRanges();csel3.addRange(colorSavedRange);}
        colorSavedRange=null;
      }
      try{ window.focus(); }catch(_){}
      var sel3=window.getSelection();
      if(!sel3||sel3.isCollapsed) return;
      // Snapshot pre-existing font[size="7"] so we only replace newly created ones
      var existingFonts=Array.prototype.slice.call(document.querySelectorAll('font[size="7"]'));
      document.execCommand('styleWithCSS',false,'false');
      document.execCommand('fontSize',false,'7');
      document.querySelectorAll('font[size="7"]').forEach(function(f){
        if(existingFonts.indexOf(f)>=0) return;
        var span=document.createElement('span');
        span.style.fontSize=pt+'pt';
        span.innerHTML=f.innerHTML;
        f.parentNode.replaceChild(span,f);
      });
      triggerSave();
    }
    if(e.data.type==='fact-link'){
      var anch=getAnchorLink();
      saveSelection();
      showLinkDialog(anch?anch.getAttribute('href'):null);
    }
    if(e.data.type==='fact-lineheight'){
      var lhVal=e.data.val;
      if(!lhVal) return;
      // Apply line-height to the nearest block-level ancestor of the cursor
      var lhSel=window.getSelection();
      if(!lhSel||!lhSel.rangeCount) return;
      var lhNode=lhSel.getRangeAt(0).startContainer;
      var lhEl=lhNode.nodeType===3?lhNode.parentElement:lhNode;
      var applied=false;
      while(lhEl&&lhEl!==document.body){
        var lhTag=lhEl.tagName||'';
        if(/^(P|H[1-6]|BLOCKQUOTE|PRE|LI|DIV)$/.test(lhTag)){
          lhEl.style.lineHeight=lhVal;
          applied=true;
          break;
        }
        lhEl=lhEl.parentElement;
      }
      // Fallback: apply to the contenteditable container
      if(!applied){
        var cnt=document.querySelector('[data-fact-edit]');
        if(cnt) cnt.style.lineHeight=lhVal;
      }
      triggerSave();
    }
    if(e.data.type==='fact-set-content'){
      // Custom undo/redo: parent sends a content snapshot to restore.
      // We set innerHTML directly and DON'T call triggerSave — the parent
      // already has this content in history and handles persistence.
      var editable=document.querySelector('[data-fact-edit]');
      if(editable&&typeof editable.focus==='function'){
        editable.focus();
        editable.innerHTML=e.data.html||'';
        // Move cursor to end so user can continue typing
        try{
          var range=document.createRange();
          range.selectNodeContents(editable);
          range.collapse(false);
          var s=window.getSelection();
          if(s){s.removeAllRanges();s.addRange(range);}
        }catch(_){}
      }
    }
  });

  // ── Report selection style to parent for toolbar sync ─────────────────────
  function rgbToHex(rgb){
    var m=rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if(!m) return '';
    return '#'+[m[1],m[2],m[3]].map(function(n){return parseInt(n).toString(16).padStart(2,'0');}).join('');
  }
  document.addEventListener('selectionchange',function(){
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount) return;
    var node=sel.getRangeAt(0).startContainer;
    var el=node.nodeType===3?node.parentElement:node;
    var blockTag=null,fontName='',fontSizePt=null,color='';
    // Fix: check for LI ancestor first. If cursor is inside a list item that
    // contains a heading (e.g. <li><h1>text</h1></li>), the heading is closer
    // to the cursor than LI, so it would win. But for block-type purposes the
    // correct answer is LI — the content belongs to a list item.
    var liCheck=el;
    while(liCheck&&liCheck!==document.body){if(liCheck.tagName==='LI'){blockTag='LI';break;}liCheck=liCheck.parentElement;}
    var cur=el;
    while(cur&&cur!==document.body){
      var tag=cur.tagName||'';
      // First block-level ancestor wins (closest to cursor) — skip if LI already set
      if(blockTag===null&&(/^H[1-6]$/.test(tag)||tag==='P'||tag==='BLOCKQUOTE'||tag==='LI'||tag==='PRE')){
        blockTag=tag;
      }
      if(!fontSizePt&&cur.style&&cur.style.fontSize){
        var fs=cur.style.fontSize;
        var ptM=fs.match(/^(\d+(?:\.\d+)?)pt$/);
        if(ptM) fontSizePt=Math.round(parseFloat(ptM[1]));
        else{var pxM=fs.match(/^(\d+(?:\.\d+)?)px$/);if(pxM) fontSizePt=Math.round(parseFloat(pxM[1])*0.75);}
      }
      if(!fontName&&cur.style&&cur.style.fontFamily){
        fontName=cur.style.fontFamily.replace(/['"]/g,'').split(',')[0].trim();
      }
      if(!color&&cur.style&&cur.style.color){
        var c=cur.style.color;
        color=c.startsWith('#')?c:rgbToHex(c);
      }
      cur=cur.parentElement;
    }
    if(!blockTag) blockTag='P';
    // Fallback to computed style when no inline font-size found
    if(!fontSizePt&&el){
      var compFs=window.getComputedStyle(el).fontSize;
      var compM=compFs.match(/^(\d+(?:\.\d+)?)px$/);
      if(compM) fontSizePt=Math.round(parseFloat(compM[1])*0.75);
    }
    // Detect line-height from inline style on block ancestor, fallback to computed
    var lineHeight='';
    var lhCur=el;
    while(lhCur&&lhCur!==document.body){
      if(lhCur.style&&lhCur.style.lineHeight){lineHeight=lhCur.style.lineHeight;break;}
      lhCur=lhCur.parentElement;
    }
    window.parent.postMessage({type:'fact-style',block:blockTag,fontName:fontName,fontSizePt:fontSizePt,color:color,lineHeight:lineHeight},'*');
  });

})();`
} // end buildInlineEditScriptTemplate

// ─────────────────────────────────────────────────────────────────────────────
// Structure overlay script — injected into the edit iframe to show visual
// section outlines with drag-to-reorder, resize handles, and spacing handles.
// All overlay elements are tagged data-fact-struct-ui so they are stripped
// before any html-change is sent to the parent.
// ─────────────────────────────────────────────────────────────────────────────
function buildStructureOverlayScript(): string { return `
;(function(){
'use strict';
if(window.__factStruct) return;
window.__factStruct=true;

var SKIP={SCRIPT:1,STYLE:1,NOSCRIPT:1,META:1,LINK:1,BASE:1,HEAD:1};
var active=false;
var items=[]; // {el,wrapper,chip,hBadge,resizeBar,reposSection,reposSpacing}

function getSections(){
  return Array.from(document.body.children).filter(function(el){return !SKIP[el.tagName];});
}

function getLabel(el){
  var h=el.querySelector('h1,h2,h3,h4,h5,h6');
  if(h) return (h.textContent||'').trim().replace(/\\s+/g,' ').slice(0,42);
  return (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,42)||el.tagName.toLowerCase();
}

var BADGE={HEADER:'HDR',NAV:'NAV',MAIN:'MAIN',FOOTER:'FTR',SECTION:'SEC',ARTICLE:'ART',ASIDE:'SID',DIV:'DIV',FORM:'FORM'};
function getBadge(t){return BADGE[t]||t.slice(0,4);}

// ── Strip overlays and send html-change ──────────────────────────────────
function structSave(){
  setTimeout(function(){
    var clone=document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-fact-struct-ui]').forEach(function(n){n.remove();});
    clone.querySelectorAll('[data-fact-editor]').forEach(function(n){n.remove();});
    ['#fact-edit-global','#fact-edit-script','#fact-edit-marker','#fact-ctx-menu','#fact-link-overlay','#fact-struct-style'].forEach(function(sel){
      var n=clone.querySelector(sel);if(n)n.remove();
    });
    clone.querySelectorAll('[contenteditable]').forEach(function(n){
      n.removeAttribute('contenteditable');n.removeAttribute('data-fact-edit');
      n.style.outline='';n.style.outlineOffset='';n.style.borderRadius='';
    });
    clone.querySelectorAll('[data-open]').forEach(function(n){n.setAttribute('data-open','false');});
    clone.querySelectorAll('[aria-expanded="true"]').forEach(function(n){n.setAttribute('aria-expanded','false');});
    window.parent.postMessage({type:'html-change',html:'<!DOCTYPE html>\\n'+clone.outerHTML},'*');
  },80);
}

// ── Drag to reorder sections ──────────────────────────────────────────────
function makeDraggable(chip,el){
  chip.addEventListener('mousedown',function(e){
    if(e.button!==0) return;
    e.preventDefault();e.stopPropagation();
    var r0=el.getBoundingClientRect();
    var startY=e.clientY;

    var ghost=document.createElement('div');
    ghost.setAttribute('data-fact-struct-ui','1');
    ghost.style.cssText='position:fixed;left:'+r0.left+'px;top:'+r0.top+'px;width:'+r0.width+'px;height:'+r0.height+'px;opacity:0.5;pointer-events:none;z-index:1000001;box-shadow:0 8px 32px rgba(0,0,0,0.25);overflow:hidden;border:2px dashed rgba(99,102,241,0.8);border-radius:4px;background:white;';
    var bg=window.getComputedStyle(el).background;
    if(bg&&bg!=='none') ghost.style.background=bg;
    document.body.appendChild(ghost);

    var line=document.createElement('div');
    line.setAttribute('data-fact-struct-ui','1');
    line.style.cssText='position:fixed;left:0;width:100%;height:3px;background:#2563eb;z-index:1000002;pointer-events:none;display:none;border-radius:2px;';
    document.body.appendChild(line);

    el.style.opacity='0.2';
    items.forEach(function(item){if(item.el===el&&item.wrapper)item.wrapper.style.opacity='0';});

    var targetRef=null;

    function onMove(ev){
      ghost.style.top=(r0.top+(ev.clientY-startY))+'px';
      var secs=getSections().filter(function(s){return s!==el;});
      targetRef=null;
      var ly=null;
      for(var i=0;i<secs.length;i++){
        var r=secs[i].getBoundingClientRect();
        if(ev.clientY<r.top+r.height/2){targetRef=secs[i];ly=r.top-1;break;}
      }
      if(ly===null&&secs.length) ly=secs[secs.length-1].getBoundingClientRect().bottom;
      if(ly!==null){line.style.display='block';line.style.top=ly+'px';}
    }

    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      ghost.remove();line.remove();
      el.style.opacity='';
      if(targetRef) document.body.insertBefore(el,targetRef);
      else{
        var footer=document.querySelector('body > footer');
        if(footer&&footer!==el) document.body.insertBefore(el,footer);
        else document.body.appendChild(el);
      }
      clearOverlays();buildOverlays();structSave();
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

// ── Resize section height ─────────────────────────────────────────────────
function makeResizable(handle,el,hBadge,wrapper){
  handle.addEventListener('mousedown',function(e){
    if(e.button!==0) return;
    e.preventDefault();e.stopPropagation();
    var startY=e.clientY;
    var startH=el.getBoundingClientRect().height;
    function onMove(ev){
      var newH=Math.max(40,startH+(ev.clientY-startY));
      el.style.minHeight=Math.round(newH)+'px';
      var r=el.getBoundingClientRect();
      if(hBadge) hBadge.textContent=Math.round(r.height)+'px';
      if(wrapper){wrapper.style.height=r.height+'px';wrapper.style.top=r.top+'px';}
      handle.style.top=(r.bottom-14)+'px';
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      repositionAll();structSave();
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}

// ── Spacing handle between sections ──────────────────────────────────────
function makeSpacingHandle(el){
  var handle=document.createElement('div');
  handle.setAttribute('data-fact-struct-ui','1');
  handle.style.cssText='position:fixed;display:none;align-items:center;justify-content:center;width:64px;height:10px;background:rgba(37,99,235,0.5);border-radius:5px;cursor:ns-resize;z-index:1000000;';
  handle.innerHTML='<span style="color:white;font-size:6px;letter-spacing:2px;pointer-events:none">&#x2022; &#x2022; &#x2022;</span>';
  var gapLbl=document.createElement('span');
  gapLbl.style.cssText='position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:9px;font-family:monospace;color:#1d4ed8;background:white;padding:0 4px;border-radius:2px;pointer-events:none;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.15);';
  handle.appendChild(gapLbl);
  document.body.appendChild(handle);

  function posHandle(){
    var r=el.getBoundingClientRect();
    var next=el.nextElementSibling;
    if(!next||SKIP[next.tagName]){handle.style.display='none';return;}
    var r2=next.getBoundingClientRect();
    var gap=Math.round(r2.top-r.bottom);
    if(gap<2){handle.style.display='none';return;}
    handle.style.display='flex';
    handle.style.top=(r.bottom+gap/2-5)+'px';
    handle.style.left=(r.left+r.width/2-32)+'px';
    gapLbl.textContent=gap+'px';
  }
  posHandle();

  handle.addEventListener('mousedown',function(e){
    if(e.button!==0) return;
    e.preventDefault();e.stopPropagation();
    var startY=e.clientY;
    var startMb=parseInt(window.getComputedStyle(el).marginBottom)||0;
    function onMove(ev){
      el.style.marginBottom=Math.max(0,Math.round(startMb+(ev.clientY-startY)))+'px';
      posHandle();repositionAll();
    }
    function onUp(){
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      structSave();
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });

  return posHandle;
}

// ── Build overlays ────────────────────────────────────────────────────────
function buildOverlays(){
  // Pointer-events override so handles work despite fact-edit-global *{pointer-events:none}
  if(!document.getElementById('fact-struct-style')){
    var st=document.createElement('style');
    st.id='fact-struct-style';
    st.textContent='[data-fact-struct-ui],[data-fact-struct-ui] *{pointer-events:auto!important;user-select:none!important;-webkit-user-select:none!important;}';
    document.head.appendChild(st);
  }

  getSections().forEach(function(el){
    var tag=el.tagName;
    var r=el.getBoundingClientRect();

    // Wrapper border
    var wrapper=document.createElement('div');
    wrapper.setAttribute('data-fact-struct-ui','1');
    wrapper.style.cssText='position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.018);z-index:999997;border-radius:2px;top:'+r.top+'px;left:'+r.left+'px;width:'+r.width+'px;height:'+r.height+'px;';
    document.body.appendChild(wrapper);

    // Chip (drag handle + badge + label) — placed above the section
    var chipY=r.top>=32 ? r.top-28 : r.top+6;
    var chip=document.createElement('div');
    chip.setAttribute('data-fact-struct-ui','1');
    chip.style.cssText='position:fixed;display:flex;align-items:center;gap:4px;top:'+chipY+'px;left:'+r.left+'px;height:24px;background:rgba(79,70,229,0.92);color:white;border-radius:4px;padding:0 7px 0 5px;font-size:10px;font-family:monospace;cursor:grab;z-index:999999;max-width:260px;overflow:hidden;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.22);';
    chip.innerHTML='<span style="font-size:12px;opacity:0.7;pointer-events:none;line-height:1">&#x28BF;</span>'+
      '<span style="font-size:8px;font-weight:700;background:rgba(255,255,255,0.22);border-radius:2px;padding:0 3px;pointer-events:none">'+getBadge(tag)+'</span>'+
      '<span style="font-size:9px;opacity:0.92;overflow:hidden;text-overflow:ellipsis;pointer-events:none">'+getLabel(el).replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>';
    document.body.appendChild(chip);

    // Height badge (top-right of section)
    var hBadge=document.createElement('div');
    hBadge.setAttribute('data-fact-struct-ui','1');
    hBadge.style.cssText='position:fixed;top:'+(r.top+6)+'px;left:'+(r.left+r.width-54)+'px;background:rgba(0,0,0,0.28);color:white;font-size:9px;font-family:monospace;padding:2px 5px;border-radius:3px;pointer-events:none;z-index:999999;';
    hBadge.textContent=Math.round(r.height)+'px';
    document.body.appendChild(hBadge);

    // Resize bar (bottom-center of section)
    var resizeBar=document.createElement('div');
    resizeBar.setAttribute('data-fact-struct-ui','1');
    resizeBar.style.cssText='position:fixed;display:flex;align-items:center;justify-content:center;top:'+(r.bottom-14)+'px;left:'+(r.left+r.width/2-36)+'px;width:72px;height:10px;background:rgba(99,102,241,0.55);border-radius:5px;cursor:ns-resize;z-index:999999;';
    resizeBar.innerHTML='<span style="color:white;font-size:7px;letter-spacing:3px;pointer-events:none">&#x2022; &#x2022; &#x2022;</span>';
    document.body.appendChild(resizeBar);

    function reposSection(){
      var r2=el.getBoundingClientRect();
      wrapper.style.top=r2.top+'px';wrapper.style.left=r2.left+'px';
      wrapper.style.width=r2.width+'px';wrapper.style.height=r2.height+'px';
      var cy=r2.top>=32?r2.top-28:r2.top+6;
      chip.style.top=cy+'px';chip.style.left=r2.left+'px';
      hBadge.style.top=(r2.top+6)+'px';hBadge.style.left=(r2.left+r2.width-54)+'px';
      hBadge.textContent=Math.round(r2.height)+'px';
      resizeBar.style.top=(r2.bottom-14)+'px';
      resizeBar.style.left=(r2.left+r2.width/2-36)+'px';
    }

    var reposSpacing=makeSpacingHandle(el);

    items.push({el:el,wrapper:wrapper,chip:chip,hBadge:hBadge,resizeBar:resizeBar,reposSection:reposSection,reposSpacing:reposSpacing});

    makeDraggable(chip,el);
    makeResizable(resizeBar,el,hBadge,wrapper);
  });
}

function clearOverlays(){
  document.querySelectorAll('[data-fact-struct-ui]').forEach(function(n){n.remove();});
  var st=document.getElementById('fact-struct-style');if(st)st.remove();
  items=[];
}

function repositionAll(){
  items.forEach(function(item){item.reposSection();if(item.reposSpacing)item.reposSpacing();});
}

function activate(){
  if(active) return;
  active=true;
  buildOverlays();
  window.addEventListener('scroll',repositionAll,{passive:true});
  window.addEventListener('resize',repositionAll,{passive:true});
  window.parent.postMessage({type:'fact-structure-state',active:true},'*');
}

function deactivate(){
  if(!active) return;
  active=false;
  clearOverlays();
  window.removeEventListener('scroll',repositionAll);
  window.removeEventListener('resize',repositionAll);
  window.parent.postMessage({type:'fact-structure-state',active:false},'*');
}

window.addEventListener('message',function(e){
  if(!e.data) return;
  if(e.data.type==='fact-structure-on') activate();
  else if(e.data.type==='fact-structure-off') deactivate();
  else if(e.data.type==='fact-structure-toggle'){active?deactivate():activate();}
});

})();
`}

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

/**
 * syncNavigation — keeps navbars consistent across all pages after structural changes.
 *
 * add_page  → the new page was generated knowing all slugs, so its <nav> is the
 *             source of truth. Copy it to every existing page.
 * delete_page → use DOMParser to remove the deleted slug's <a> (and its parent <li>)
 *               from every page's navbar.
 * other ops → no-op (edit_page / create_site don't change page count).
 */
function syncNavigation(
  pages: Page[],
  op: 'add' | 'delete' | 'none',
  targetSlug?: string
): Page[] {
  if (pages.length <= 1 || op === 'none') return pages

  if (op === 'add' && targetSlug) {
    // Source of truth for nav STRUCTURE: the home page (has the correct CSS classes,
    // mega-menu, dropdowns, etc.). The new page's AI-generated nav may have a simpler
    // structure that would break existing pages if propagated there.
    // Strategy:
    //  1. Take the home page's nav (or the first existing page with a nav).
    //  2. Add a link to the new page if it's not already there.
    //  3. Push this complete, correctly-styled nav to ALL pages (including the new one).
    const newPage = pages.find(p => p.slug === targetSlug)
    if (!newPage) return pages

    const srcPage =
      pages.find(p => p.slug === 'home' && p.slug !== targetSlug && /<nav[\s\S]*?<\/nav>/i.test(p.html)) ??
      pages.find(p => p.slug !== targetSlug && /<nav[\s\S]*?<\/nav>/i.test(p.html))

    if (!srcPage) {
      // No existing page with a nav — fall back: push new page's nav to everyone else
      const navMatch = newPage.html.match(/<nav[\s\S]*?<\/nav>/i)
      if (!navMatch) return pages
      const newNav = navMatch[0]
      return pages.map(p => {
        if (p.slug === targetSlug) return p
        if (!/<nav[\s\S]*?<\/nav>/i.test(p.html)) return p
        return { ...p, html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, newNav) }
      })
    }

    const srcNavMatch = srcPage.html.match(/<nav[\s\S]*?<\/nav>/i)
    if (!srcNavMatch) return pages
    let baseNav = srcNavMatch[0]

    // Add the new page's link to the base nav only if it isn't already there
    const alreadyLinked = new RegExp(`href=["'](?:\\./)?(${targetSlug})/?["']`, 'i').test(baseNav)
    if (!alreadyLinked) {
      const newPageLabel = newPage.name ?? targetSlug
      const newLink = `<li><a href="./${targetSlug}">${newPageLabel}</a></li>`
      // Insert before the last </ul> inside the nav
      const ulCloseIdx = baseNav.lastIndexOf('</ul>')
      if (ulCloseIdx !== -1) {
        baseNav = baseNav.slice(0, ulCloseIdx) + newLink + baseNav.slice(ulCloseIdx)
      } else {
        // No <ul> — insert before </nav>
        baseNav = baseNav.replace(/<\/nav>/i, `${newLink}</nav>`)
      }
    }

    // Propagate the complete nav to every page (including the new one)
    return pages.map(p => {
      if (!/<nav[\s\S]*?<\/nav>/i.test(p.html)) return p
      return { ...p, html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, baseNav) }
    })
  }

  if (op === 'delete' && targetSlug && typeof window !== 'undefined') {
    return pages.map(p => {
      if (!p.html.includes(targetSlug)) return p
      const doc = new DOMParser().parseFromString(p.html, 'text/html')
      doc.querySelectorAll(`a[href*="${targetSlug}"]`).forEach(a => {
        const li = a.closest('li')
        if (li) li.remove()
        else a.remove()
      })
      const hasDoctype = /^\s*<!DOCTYPE/i.test(p.html)
      return { ...p, html: (hasDoctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML }
    })
  }

  return pages
}

/** Checks whether any page's nav already contains a /blog link */
function hasBlogNavLink(pages: Page[]): boolean {
  return pages.some(p => /href=["']\.?\/blog["']/i.test(p.html))
}

/** Adds <a href="./blog">Blog</a> (wrapped in <li> if nav uses <li>) to all pages' navs */
function addBlogLinkToNav(pages: Page[], label = 'Blog'): Page[] {
  return pages.map(page => {
    if (/href=["']\.?\/blog["']/i.test(page.html)) return page
    // Try inserting before </ul> inside <nav>
    if (/<nav[\s\S]*?<ul[\s\S]*?<\/ul>[\s\S]*?<\/nav>/i.test(page.html)) {
      return {
        ...page,
        html: page.html.replace(
          /(<nav[\s\S]*?<ul[\s\S]*?)(<\/ul>)/i,
          (_, before, closing) => `${before}<li><a href="./blog">${label}</a></li>${closing}`
        ),
      }
    }
    // Fallback: insert before </nav>
    return {
      ...page,
      html: page.html.replace(
        /(<nav[\s\S]*?)(<\/nav>)/i,
        (_, before, closing) => `${before}<a href="./blog">${label}</a>${closing}`
      ),
    }
  })
}

/** Removes any nav link pointing to /blog from all pages */
function removeBlogLinkFromNav(pages: Page[]): Page[] {
  return pages.map(page => ({
    ...page,
    html: page.html
      // Remove <li>...<a href="./blog">...</a>...</li>
      .replace(/<li[^>]*>(?:\s*<[^>]+>)*\s*<a[^>]+href=["']\.?\/blog["'][^>]*>[^<]*<\/a>(?:\s*<\/[^>]+>)*\s*<\/li>/gi, '')
      // Remove bare <a href="./blog">...</a>
      .replace(/<a[^>]+href=["']\.?\/blog["'][^>]*>[^<]*<\/a>/gi, ''),
  }))
}

/**
 * reorderNavLinks — after a drag-reorder, updates every page's <nav> so the
 * link order matches the new pages array order.
 * Also applies menuLabel overrides and respects inMenu=false (removes those links).
 */
function reorderNavLinks(pages: Page[]): Page[] {
  if (typeof window === 'undefined' || pages.length <= 1) return pages
  const navRe = /<nav[\s\S]*?<\/nav>/i
  // Always prefer the home page as the nav source — it's the single source of truth.
  const srcPage = pages.find(p => p.slug === 'home' && navRe.test(p.html)) ?? pages.find(p => navRe.test(p.html))
  if (!srcPage) return pages
  const navMatch = srcPage.html.match(navRe)
  if (!navMatch) return pages

  const doc = new DOMParser().parseFromString(navMatch[0], 'text/html')
  const nav = doc.querySelector('nav')
  if (!nav) return pages

  const liItems = [...nav.querySelectorAll('li')].filter(li => li.querySelector('a'))
  const aItems  = liItems.length === 0 ? [...nav.querySelectorAll('a')] : []
  const items   = liItems.length > 0 ? liItems : aItems
  if (items.length === 0) return pages

  // Map slug → nav item, AND track items that didn't match any page
  // (anchor links like #features, external links, etc.) so we can preserve them.
  const slugToItem = new Map<string, Element>()
  const matched = new Set<Element>()
  for (const item of items) {
    const a = (item.tagName === 'A' ? item : item.querySelector('a')) as HTMLAnchorElement | null
    if (!a) continue
    const href = a.getAttribute('href') ?? ''
    for (const page of pages) {
      const variants = [
        page.slug === 'home' ? './' : `./${page.slug}`,
        page.slug === 'home' ? '/' : `/${page.slug}`,
        page.slug,
      ]
      if (variants.some(v => href === v || href.endsWith(`/${page.slug}`))) {
        slugToItem.set(page.slug, item)
        matched.add(item)
        // Apply menuLabel if set
        if (page.menuLabel && page.menuLabel !== page.name) a.textContent = page.menuLabel
        break
      }
    }
  }
  // Preserve unmatched items in their original order (anchor links, external,
  // unknown hrefs) so they survive a reorder. Without this, they'd be silently
  // dropped, which is how 'menu items disappeared from the site' happens.
  const unmatched = items.filter(i => !matched.has(i))
  if (unmatched.length > 0) {
    console.warn('[reorderNavLinks] preserving', unmatched.length, 'unmatched nav items')
  }

  // Reorder inside parent
  const parent = items[0].parentElement
  if (parent) {
    items.forEach(el => el.remove())
    // 1) Matched items in pages order (respecting inMenu=false)
    for (const page of pages) {
      if (page.inMenu === false) continue
      const item = slugToItem.get(page.slug)
      if (item) parent.appendChild(item)
    }
    // 2) Append unmatched items at the end so they aren't lost
    for (const item of unmatched) {
      parent.appendChild(item)
    }
  }

  const newNavHtml = nav.outerHTML
  return pages.map(p => ({
    ...p,
    html: navRe.test(p.html) ? p.html.replace(navRe, newNavHtml) : p.html,
  }))
}

/**
 * Merge shared_css into a page's HTML — MUST mirror applySharedCss in lib/preview.ts.
 * - Self-contained pages (own component CSS) → only sync the :root token block,
 *   keep their component styling (prevents the "pagina sballata" bug).
 * - Token-only pages (no real component CSS) → strip + inject full shared_css.
 */
function mergeSharedCssIntoPage(html: string, sharedCss: string): string {
  const pageStyles = html.match(/<style[\s\S]*?<\/style>/gi) ?? []
  const pageStyleContent = pageStyles.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
  const remainder = pageStyleContent
    .replace(/:root\s*\{[\s\S]*?\}/gi, '')
    .replace(/\*[^{]*\{[^}]*\}/g, '')
    .trim()
  const isSelfContained = remainder.length > 300

  if (isSelfContained) {
    // Merge shared :root into the page's own :root (page vars win) — mirrors
    // applySharedCss in lib/preview.ts. Prevents wiping page-specific variables.
    const sharedRoot = sharedCss.match(/:root\s*\{[\s\S]*?\}/i)?.[0]
    const pageRoot = html.match(/:root\s*\{[\s\S]*?\}/i)?.[0]
    if (sharedRoot && pageRoot) {
      return html.replace(/:root\s*\{[\s\S]*?\}/i, mergeRootVars(pageRoot, sharedRoot))
    }
    if (sharedRoot) {
      const styleTag = `<style>${sharedRoot}</style>`
      return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${styleTag}\n</head>`) : styleTag + html
    }
    return html
  }
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  const styleTag = `<style>${sharedCss}</style>`
  return /<\/head>/i.test(stripped) ? stripped.replace(/<\/head>/i, `${styleTag}\n</head>`) : styleTag + stripped
}

function stripEditorArtifacts(html: string): string {
  if (typeof window === 'undefined' || !html) return html
  // Quick exit if no markers present (also check for <base> which may have accumulated)
  if (!/fact-edit|contenteditable|html-change|<base/i.test(html)) return html

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

  // Editor-injected elements (new: data-fact-editor attribute) — must never be saved to page HTML
  doc.querySelectorAll('[data-fact-editor]').forEach(el => el.remove())

  // Legacy: <base> tags accumulated from old editor sessions (pages should never have <base> tags)
  doc.querySelectorAll('base').forEach(el => el.remove())

  // Residual attributes from interrupted edit sessions
  doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'))
  doc.querySelectorAll('[data-fact-edit]').forEach(el => el.removeAttribute('data-fact-edit'))
  doc.querySelectorAll('[data-fact-href]').forEach(el => el.removeAttribute('data-fact-href'))

  const hasDoctype = /^\s*<!DOCTYPE/i.test(html)

  // Normalize mobile-menu toggle class: standardize on "open"
  let serialized = (hasDoctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML
  serialized = serialized.replace(/mobile-menu active/g, 'mobile-menu open')
                         .replace(/\.mobile-menu\.active\s*\{/g, '.mobile-menu.open {')

  // Remove blank lines — lines with only whitespace look bad in the code view
  // and add no semantic value. Collapse 2+ consecutive blank lines into nothing.
  serialized = serialized.replace(/\n(\s*\n)+/g, '\n')

  return serialized
}

// Preview agent-context script — injected into the PREVIEW iframe.
// Two signals sent to parent, both zero-cost and automatic:
//
// 1. fact-visible-blocks (automatic, no user action)
//    IntersectionObserver tracks which structural blocks are in viewport.
//    Sent whenever the visible set changes OR on-demand when parent asks.
//    Agent context: "user was looking at [section#pricing, footer]".
//
// 2. fact-element-click (on explicit click)
//    User clicked an element — captures exact block + anchor text.
//    Takes priority over visible-blocks in agent routing.
const PREVIEW_CLICK_SCRIPT = `<script data-fact-preview-agent>
(function(){
  var STRUCT=['section','header','footer','nav','main','article','aside'];
  var visibleBlocks=[];

  function blockSelector(el){
    var cur=el;
    while(cur&&cur!==document.body){
      var tag=(cur.tagName||'').toLowerCase();
      if(STRUCT.includes(tag)||tag==='div'){
        var s=tag;
        if(cur.id)s+='#'+cur.id;
        else if(cur.className&&typeof cur.className==='string'){var c=cur.className.trim().split(/\\s+/)[0];if(c)s+='.'+c;}
        return s;
      }
      cur=cur.parentElement;
    }
    return (el.tagName||'').toLowerCase();
  }

  function anchorText(el){
    var h=el.querySelector('h1,h2,h3,h4,h5,h6');
    if(h)return(h.innerText||'').trim().slice(0,80);
    return(el.innerText||'').trim().slice(0,80);
  }

  // ── 1. IntersectionObserver — track visible blocks automatically ──
  function observeBlocks(){
    var targets=document.querySelectorAll(STRUCT.join(','));
    if(!targets.length)return;
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        var sel=blockSelector(e.target);
        if(e.isIntersecting){if(!visibleBlocks.includes(sel))visibleBlocks.push(sel);}
        else{visibleBlocks=visibleBlocks.filter(function(s){return s!==sel;});}
      });
      window.parent.postMessage({type:'fact-visible-blocks',blocks:visibleBlocks.slice()},'*');
    },{threshold:0.2});
    targets.forEach(function(t){io.observe(t);});
  }

  // Run after DOM is ready
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',observeBlocks);}
  else{observeBlocks();}

  // Listen for on-demand request from parent (sent when user focuses chat input)
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='fact-get-visible')
      window.parent.postMessage({type:'fact-visible-blocks',blocks:visibleBlocks.slice()},'*');
  });

  // ── 2. Click detection — user explicitly clicked something ──
  document.addEventListener('click',function(e){
    var el=e.target;if(!el)return;
    var block=blockSelector(el);
    var anchor=anchorText(el.closest('section,header,footer,nav,div,article')||el);
    window.parent.postMessage({type:'fact-element-click',blockSelector:block,anchorText:anchor,outerHtml:(el.outerHTML||'').slice(0,400)},'*');
  },false);
})();
<\/script>`

const SCROLL_LISTENER = `<script>
window.addEventListener('message',function(e){
  if(!e.data)return;
  // scroll-to-text
  if(e.data.type==='scroll-to-text'){
    var text=e.data.text;if(!text)return;
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
    var node;
    while((node=walker.nextNode())){
      if(node.textContent&&node.textContent.trim().includes(text.trim())){
        var el=node.parentElement;
        if(el){el.scrollIntoView({behavior:'smooth',block:'center'});break;}
      }
    }
  }
  // fact-block-update — replace a single block in DOM without full reload (Fase 2a)
  if(e.data.type==='fact-block-update'){
    var sel=e.data.selector;var html=e.data.html;
    if(!sel||!html)return;
    try{
      var target=document.querySelector(sel);
      if(target){
        var tmp=document.createElement('div');
        tmp.innerHTML=html;
        var newEl=tmp.firstElementChild;
        if(newEl){
          target.replaceWith(newEl);
          newEl.scrollIntoView({behavior:'smooth',block:'nearest'});
          // Flash highlight
          newEl.style.outline='2px solid #2563eb';
          newEl.style.outlineOffset='2px';
          setTimeout(function(){newEl.style.outline='';newEl.style.outlineOffset='';},1200);
        }
      }
    }catch(err){}
  }
});
</script>`

const EDITOR_GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Lato:ital,wght@0,400;0,700;1,400&family=Roboto:ital,wght@0,400;0,700;1,400&family=Open+Sans:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@400;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:ital,wght@0,400;0,700;1,400&display=swap'

// These elements are editor-only — they must NEVER be saved back to the page HTML.
// We tag them with data-fact-editor so triggerSave() and stripEditorArtifacts() can remove them.
const EDITOR_FONTS_INJECT = `<link data-fact-editor rel="preconnect" href="https://fonts.googleapis.com"><link data-fact-editor rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link data-fact-editor id="fact-editor-fonts" href="${EDITOR_GOOGLE_FONTS_URL}" rel="stylesheet">`

function injectBase(html: string, projectSlug: string, sharedNav?: string, sharedFooter?: string, sharedCss?: string, faviconUrl?: string): string {
  let clean = stripEditorArtifacts(html)

  // Inject shared nav/footer so the editor preview matches the served site.
  // Home page is source of truth — replaces page nav/footer, or inserts if absent.
  if (sharedNav) {
    if (/<nav[\s\S]*?<\/nav>/i.test(clean)) {
      clean = clean.replace(/<nav[\s\S]*?<\/nav>/i, sharedNav)
    } else if (/<body[^>]*>/i.test(clean)) {
      clean = clean.replace(/<body([^>]*)>/i, `<body$1>\n${sharedNav}`)
    }
  }
  if (sharedFooter) {
    if (/<footer[\s\S]*?<\/footer>/i.test(clean)) {
      clean = clean.replace(/<footer[\s\S]*?<\/footer>/i, sharedFooter)
    } else if (/<\/body>/i.test(clean)) {
      clean = clean.replace(/<\/body>/i, `${sharedFooter}\n</body>`)
    }
  }

  // data-fact-editor marks these tags as editor-only so triggerSave() removes them before saving
  const baseTag = `<base data-fact-editor href="/preview/${projectSlug}/">`
  // Favicon: remove any existing icon link, inject user's favicon if set
  if (faviconUrl && /<head[^>]*>/i.test(clean)) {
    clean = clean.replace(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*\/?>/gi, '')
    clean = clean.replace(/<head[^>]*>/i, (m) => `${m}\n<link rel="icon" type="image/png" href="${faviconUrl}" data-fact-editor>`)
  }
  const inject = `${baseTag}\n${EDITOR_FONTS_INJECT}`
  // Canonical header/footer CSS + global layout fix — injected just before </head>
  // (AFTER page styles) so the shared frame wins in cascade. Mirrors lib/preview.ts.
  const frameCss = sharedCss ? buildSharedFrameCss(sharedNav ?? '', sharedFooter ?? '', sharedCss) : ''
  const frameTag = `<style data-fact-editor id="nfd-frame-fix">${FRAME_GLOBAL_FIX}</style>${frameCss ? `\n<style data-fact-editor id="nfd-frame-css">${frameCss}</style>` : ''}`
  if (/<\/body>/i.test(clean)) {
    return clean
      .replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`)
      .replace(/<\/body>/i, `${SCROLL_LISTENER}</body>`)
      .replace(/<\/head>/i, `${frameTag}\n</head>`)
  }
  if (/<head[^>]*>/i.test(clean)) {
    return clean
      .replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`)
      .replace(/<\/head>/i, `${frameTag}\n</head>`)
  }
  return inject + `\n${frameTag}` + clean
}

/** Like injectBase but for the PREVIEW panel (chat sidebar) — adds click-detection script. */
function injectBasePreview(html: string, projectSlug: string, sharedNav?: string, sharedFooter?: string, sharedCss?: string, faviconUrl?: string): string {
  const base = injectBase(html, projectSlug, sharedNav, sharedFooter, sharedCss, faviconUrl)
  if (/<\/body>/i.test(base)) return base.replace(/<\/body>/i, `${PREVIEW_CLICK_SCRIPT}</body>`)
  return base + PREVIEW_CLICK_SCRIPT
}

// ── Design System Types ────────────────────────────────────────────────────
type TypoConfig = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  color: string
  lineHeight: string
  letterSpacing: string
}
type BulletConfig = { symbol: string; size: string }
type DesignSystem = {
  h1: TypoConfig; h2: TypoConfig; h3: TypoConfig; h4: TypoConfig
  h5: TypoConfig; h6: TypoConfig; p: TypoConfig; li: TypoConfig; a: TypoConfig
  bullet: BulletConfig
}
const DEFAULT_DESIGN_SYSTEM: DesignSystem = {
  h1: { fontFamily: 'inherit', fontSize: '2.2rem',  fontWeight: '700', color: '#1a1a1a', lineHeight: '1.2',  letterSpacing: '-0.02em' },
  h2: { fontFamily: 'inherit', fontSize: '1.8rem',  fontWeight: '700', color: '#1a1a1a', lineHeight: '1.25', letterSpacing: '-0.01em' },
  h3: { fontFamily: 'inherit', fontSize: '1.4rem',  fontWeight: '600', color: '#1a1a1a', lineHeight: '1.3',  letterSpacing: '0' },
  h4: { fontFamily: 'inherit', fontSize: '1.15rem', fontWeight: '600', color: '#1a1a1a', lineHeight: '1.35', letterSpacing: '0' },
  h5: { fontFamily: 'inherit', fontSize: '1rem',    fontWeight: '600', color: '#374151', lineHeight: '1.4',  letterSpacing: '0' },
  h6: { fontFamily: 'inherit', fontSize: '0.9rem',  fontWeight: '600', color: '#374151', lineHeight: '1.4',  letterSpacing: '0' },
  p:  { fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: '400', color: '#374151', lineHeight: '1.7',  letterSpacing: '0' },
  li: { fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: '400', color: '#374151', lineHeight: '1.7',  letterSpacing: '0' },
  a:  { fontFamily: 'inherit', fontSize: 'inherit', fontWeight: '500', color: '#2563eb', lineHeight: 'inherit', letterSpacing: '0' },
  bullet: { symbol: '•', size: '0.65em' },
}

function generateDesignSystemCSS(ds: DesignSystem): { rules: string; fontFamilies: string[] } {
  const googleFonts = new Set<string>()
  const systemFonts = new Set(['Georgia','Times New Roman','Arial','Helvetica','Verdana','Trebuchet MS','Courier New'])
  const rule = (tag: string, c: TypoConfig) => {
    const props: string[] = []
    if (c.fontFamily && c.fontFamily !== 'inherit') {
      if (!systemFonts.has(c.fontFamily)) googleFonts.add(c.fontFamily)
      props.push(`font-family:'${c.fontFamily}',sans-serif`)
    }
    if (tag !== 'a') {
      if (c.fontSize   && c.fontSize   !== 'inherit') props.push(`font-size:${c.fontSize}`)
    }
    if (c.fontWeight && c.fontWeight !== 'inherit') props.push(`font-weight:${c.fontWeight}`)
    if (c.color      && c.color      !== 'inherit') props.push(`color:${c.color}`)
    if (tag !== 'a') {
      if (c.lineHeight && c.lineHeight !== 'inherit') props.push(`line-height:${c.lineHeight}`)
      if (c.letterSpacing && c.letterSpacing !== '0' && c.letterSpacing !== 'inherit') props.push(`letter-spacing:${c.letterSpacing}`)
    }
    if (!props.length) return ''
    // Plain selector (not :where) — specificity (0,0,1) for tags, injected last in <head>
    // so it wins over earlier site CSS rules at equal specificity.
    const base = `${tag}{${props.join(';')}}`
    // .blog-post-content selectors for blog pages (come after BLOG_POST_CONTENT_CSS)
    const blogTags = new Set(['h1','h2','h3','h4','h5','h6','p','li'])
    const blogRule = blogTags.has(tag) ? `.blog-post-content ${tag}{${props.join(';')}}` : ''
    // p rule also targets div (old AI content uses <div> for paragraphs)
    const divRule = tag === 'p' ? `.blog-post-content div{${props.join(';')}}` : ''
    // li: force children to inherit so old inline styles don't leak
    const liSpanRule = tag === 'li' ? `.blog-post-content li span,.blog-post-content li b,.blog-post-content li strong{font-size:inherit;color:inherit}` : ''
    return [base, blogRule, divRule, liSpanRule].filter(Boolean).join('\n')
  }
  const tags = ['h1','h2','h3','h4','h5','h6','p','li','a'] as const
  const cssRules = tags.map(t => rule(t, ds[t])).filter(Boolean).join('\n')
  // Bullet symbol & size — emitted as scoped ::before rule
  const b = ds.bullet ?? DEFAULT_DESIGN_SYSTEM.bullet
  const bulletRule = `.blog-post-content ul>li::before{content:"${b.symbol}";font-size:${b.size}}`
  return { rules: cssRules + '\n' + bulletRule, fontFamilies: [...googleFonts] }
}

/** Build the full CSS string including @import at top (needed when injecting into a <style> block) */
function buildDesignSystemCSSString(ds: DesignSystem): string {
  const { rules, fontFamilies } = generateDesignSystemCSS(ds)
  if (!rules.trim()) return ''
  let imports = ''
  if (fontFamilies.length > 0) {
    const families = fontFamilies.map(f => `family=${f.replace(/ /g,'+')}:wght@300;400;500;600;700;800`).join('&')
    imports = `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n`
  }
  return imports + rules
}

function applyDesignSystemToPages(ds: DesignSystem, currentPages: Page[]): Page[] {
  const css = buildDesignSystemCSSString(ds)
  if (!css.trim()) return currentPages
  const styleTag = `<style id="fact-design-system">\n/* Factulista Design System - auto-generated */\n${css}\n</style>`
  return currentPages.map(p => {
    // Strip ALL existing fact-design-system style tags (handles accidental duplicates)
    let html = p.html.replace(/<style[^>]*id="fact-design-system"[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${styleTag}\n</head>`)
    } else {
      html = styleTag + '\n' + html
    }
    return { ...p, html }
  })
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
  const [showComponentCanvas, setShowComponentCanvas] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsgId, setLoadingMsgId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const loadingStartRef = useRef<number>(0)
  // Chat lazy loading — show only the last N messages, load more on scroll-up
  const CHAT_INITIAL = 20
  const CHAT_MORE = 20
  const [visibleMsgCount, setVisibleMsgCount] = useState(CHAT_INITIAL)
  const chatListRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const chatScrollAnchor = useRef<{ height: number; top: number } | null>(null)
  const sentinelReadyRef = useRef(false)
  // Typing animation for new assistant messages
  const [typingContent, setTypingContent] = useState<Record<string, string>>({})
  const typingTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  const typedMsgIds = useRef(new Set<string>())
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
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'edit' | 'media' | 'seo' | 'pages' | 'blog' | 'design' | 'integrations'>('preview')
  const [brevoApiKey, setBrevoApiKey] = useState('')
  const [brevoListId, setBrevoListId] = useState('')
  const [brevoSaving, setBrevoSaving] = useState<'idle'|'saving'|'saved'>('idle')
  const [brevoTesting, setBrevoTesting] = useState<'idle'|'testing'|'ok'|'error'>('idle')
  // Contact form component config
  const [cfAdminEmail, setCfAdminEmail]           = useState('')
  const [cfConfirmMsg, setCfConfirmMsg]           = useState('')
  const [cfConfirmEmailMsg, setCfConfirmEmailMsg] = useState('')
  const [cfRedirectUrl, setCfRedirectUrl]         = useState('')
  const [cfTurnstileSiteKey, setCfTurnstileSiteKey] = useState('')
  const [cfSaving, setCfSaving]                   = useState<'idle'|'saving'|'saved'>('idle')
  // CRM interest form config
  const [crmAdminEmail, setCrmAdminEmail]             = useState('')
  const [crmConfirmMsg, setCrmConfirmMsg]             = useState('')
  const [crmConfirmEmailMsg, setCrmConfirmEmailMsg]   = useState('')
  const [crmRedirectUrl, setCrmRedirectUrl]           = useState('')
  const [crmTurnstileSiteKey, setCrmTurnstileSiteKey] = useState('')
  const [crmSaving, setCrmSaving]                         = useState<'idle'|'saving'|'saved'>('idle')
  // Suggest module form config
  const [suggestAdminEmail, setSuggestAdminEmail]         = useState('')
  const [suggestConfirmMsg, setSuggestConfirmMsg]         = useState('')
  const [suggestConfirmEmailMsg, setSuggestConfirmEmailMsg] = useState('')
  const [suggestRedirectUrl, setSuggestRedirectUrl]       = useState('')
  const [suggestTurnstileSiteKey, setSuggestTurnstileSiteKey] = useState('')
  const [suggestSaving, setSuggestSaving]                 = useState<'idle'|'saving'|'saved'>('idle')
  const [activeComponent, setActiveComponent]             = useState<'contact_form'|'crm_form'|'suggest_form'|null>(null)
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editSlugValue, setEditSlugValue] = useState('')
  const [menuLabelValue, setMenuLabelValue] = useState('')
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // ── Blog state ──────────────────────────────────────────────────────────────
  type BlogPost = { id: string; title: string; slug: string; excerpt: string; featured_image: string | null; status: 'draft' | 'published'; published_at: string | null; categories: string[]; tags: string[]; seo_title: string | null; seo_description: string | null; content_html?: string; created_at: string; updated_at: string; author: string }
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([])
  const [blogLoading, setBlogLoading] = useState(false)
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null)
  const [blogHeaderHtml, setBlogHeaderHtml] = useState('')
  const [blogHeaderEditorOpen, setBlogHeaderEditorOpen] = useState(false)
  const [blogHeaderSaving, setBlogHeaderSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [blogSidebarBannerUrl, setBlogSidebarBannerUrl] = useState('')
  const [blogSidebarBannerLink, setBlogSidebarBannerLink] = useState('')
  const [blogSidebarBannerOpen, setBlogSidebarBannerOpen] = useState(false)
  const [injectPoints, setInjectPoints] = useState<Record<string, string>>({})
  // 301 redirects (SEO Optimizer → Strumenti)
  const [redirects, setRedirects] = useState<Array<{ from: string; to: string }>>([])
  const [newRedirectFrom, setNewRedirectFrom] = useState('')
  const [newRedirectTo, setNewRedirectTo] = useState('')
  const [redirectSaving, setRedirectSaving] = useState(false)
  // Site-wide default OG image (fallback for pages without their own)
  const [defaultOgImage, setDefaultOgImage] = useState('')
  const [defaultOgPickerOpen, setDefaultOgPickerOpen] = useState(false)
  const [injectPointsOpen, setInjectPointsOpen] = useState(false)
  const [injectPointsSaving, setInjectPointsSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const injectPointsRef = useRef<Record<string, string>>({})
  const [blogSidebarBannerSaving, setBlogSidebarBannerSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showUrlDropdown, setShowUrlDropdown] = useState(false)
  const [userFullName, setUserFullName] = useState('')
  const [previewIframePath, setPreviewIframePath] = useState<string | null>(null)
  // Preview click selection — user explicitly clicked an element.
  const [previewSelection, setPreviewSelection] = useState<{
    blockSelector: string
    anchorText: string
    outerHtml: string
    timestamp: number
  } | null>(null)
  // Visible blocks — automatically tracked by IntersectionObserver in the preview iframe.
  // Updated whenever the viewport changes; no user action required.
  const [visibleBlocks, setVisibleBlocks] = useState<string[]>([])
  const [blogEditorSrcDoc, setBlogEditorSrcDoc] = useState('')
  const [blogEditorSiteStyles, setBlogEditorSiteStyles] = useState('')
  const [blogSaving, setBlogSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const blogPendingSaveRef = useRef<{ postId: string; contentHtml: string } | null>(null)
  // Custom undo/redo for blog editor: snapshot history at the parent level
  // (browser's native execCommand('undo') is unreliable for contenteditable
  // in iframes — it can duplicate content after formatBlock).
  const blogHistoryRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 })
  const undoOpInFlightRef = useRef(false)
  const [blogActiveBlock, setBlogActiveBlock] = useState<string>('')
  const [blogListOpen, setBlogListOpen] = useState(false)
  const [blogInsertOpen, setBlogInsertOpen] = useState(false)
  const [blogAlignOpen, setBlogAlignOpen] = useState(false)
  const [blogTableHov, setBlogTableHov] = useState<[number,number]>([0,0])
  // ── Design System state ──────────────────────────────────────────────────
  const [designSystem, setDesignSystem] = useState<DesignSystem>(DEFAULT_DESIGN_SYSTEM)
  const [designSaving, setDesignSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  // ── Inline editor toolbar state ──────────────────────────────────────────
  const [inlineActiveBlock, setInlineActiveBlock] = useState<string>('')
  const [inlineFontName, setInlineFontName] = useState('')
  const [inlineFontSizePt, setInlineFontSizePt] = useState<number | null>(null)
  const inlineColorInputRef = useRef<HTMLInputElement | null>(null)
  const [inlineListOpen, setInlineListOpen] = useState(false)
  const [inlineInsertOpen, setInlineInsertOpen] = useState(false)
  const [inlineAlignOpen, setInlineAlignOpen] = useState(false)
  const [blogFontName, setBlogFontName] = useState('')
  const [blogFontSizePt, setBlogFontSizePt] = useState<number | null>(null)
  const [blogLineHeight, setBlogLineHeight] = useState<string>('')
  const blogColorInputRef = useRef<HTMLInputElement | null>(null)
  const inlineImgInputRef = useRef<HTMLInputElement | null>(null)
  const [mediaPickerTarget, setMediaPickerTarget] = useState<'inline' | 'blog' | null>(null)
  const mediaPickerUploadRef = useRef<HTMLInputElement | null>(null)
  const [blogPublishing, setBlogPublishing] = useState(false)
  const [blogGenerating, setBlogGenerating] = useState(false)
  const [blogGenTopic, setBlogGenTopic] = useState('')
  const [blogGenKeywords, setBlogGenKeywords] = useState('')
  const [blogGenWordCount, setBlogGenWordCount] = useState(1200)
  const [blogGenParaCount, setBlogGenParaCount] = useState(4)
  const [blogGenH3Count, setBlogGenH3Count] = useState(2)
  const [blogGenH4Count, setBlogGenH4Count] = useState(0)
  const [blogGenFlags, setBlogGenFlags] = useState({
    table: true,
    summary: true,
    takeaways: true,
    faq: true,
    cta: false,
    callout: false,
    stats: false,
  })
  const [showBlogGenPrompt, setShowBlogGenPrompt] = useState(false)
  const [blogGenDraftId, setBlogGenDraftId] = useState<string | null>(null)
  const [blogGenLiveContent, setBlogGenLiveContent] = useState('')
  const [blogMetaEdits, setBlogMetaEdits] = useState<Partial<BlogPost>>({})
  const blogAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blogBaseHtmlRef = useRef<string>('')
  const blogIframeRef = useRef<HTMLIFrameElement>(null)

  const [projectContext, setProjectContext] = useState<{ businessName?: string; businessType?: string; services?: string[]; language?: string; targetAudience?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [seoAnalyses, setSeoAnalyses] = useState<PageAnalysis[]>([])
  const [seoPageSlug, setSeoPageSlug] = useState<string>('all')
  const [seoFixing, setSeoFixing] = useState<CheckId | null>(null)
  const [seoFixError, setSeoFixError] = useState<string | null>(null)
  const seoFixingRef = useRef<boolean>(false)
  const [linkCheckRunning, setLinkCheckRunning] = useState(false)
  const [linkCheckResults, setLinkCheckResults] = useState<{ pageSlug: string; pageName: string; brokenLinks: Array<{ url: string; status: number | string }> }[] | null>(null)
  const [linkCheckTime, setLinkCheckTime] = useState<string | null>(null)
  const [linkCheckTotals, setLinkCheckTotals] = useState<{ checked: number; broken: number } | null>(null)
  const [gtmId, setGtmId] = useState('')
  const [gtmSaving, setGtmSaving] = useState<'idle'|'saving'|'saved'>('idle')
  const [seoSubTab, setSeoSubTab] = useState<'checks'|'tools'|'sitemap'|'keywords'>('checks')
  const [seoKeywords, setSeoKeywords] = useState<Array<{keyword:string;volume:number;difficulty:number;intent?:string;parentKeyword?:string}>>([])
  const [keywordsUploading, setKeywordsUploading] = useState(false)
  const [kwSearch, setKwSearch] = useState('')
  const [kwVolSort, setKwVolSort] = useState<'desc'|'asc'>('desc')
  const [kwIntentFilter, setKwIntentFilter] = useState('')
  const [kwPage, setKwPage] = useState(0)
  const [suggestedKeywordsForArticle, setSuggestedKeywordsForArticle] = useState<Array<{keyword:string;volume:number;difficulty:number}>>([])
  const [articleKeywordChips, setArticleKeywordChips] = useState<string[]>([])
  const [sitemapDownloading, setSitemapDownloading] = useState(false)
  const [sitemapCopied, setSitemapCopied] = useState(false)
  const [robotsCopied, setRobotsCopied] = useState(false)
  const [mediaAiGenerating, setMediaAiGenerating] = useState(false)
  const [cfApiToken, setCfApiToken] = useState('')
  const [cfZoneId, setCfZoneId] = useState('')
  const [cfConfiguring, setCfConfiguring] = useState(false)
  const [registrarInfo, setRegistrarInfo] = useState<{
    isCloudflare: boolean; registrarKey: string | null; registrarName: string | null; dnsPanel: string | null; note: string | null
  } | null>(null)
  const [detectingRegistrar, setDetectingRegistrar] = useState(false)
  const [showManualDns, setShowManualDns] = useState(false)
  const [removingDomain, setRemovingDomain] = useState(false)
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaSearch, setMediaSearch] = useState('')
  const [mediaSort, setMediaSort] = useState<'recent' | 'oldest' | 'name'>('recent')
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const [mediaMeta, setMediaMeta] = useState<Record<string, MediaMeta>>({})
  const [faviconUrl, setFaviconUrl] = useState<string>('')
  const [ogPickerSlug, setOgPickerSlug] = useState<string | null>(null)
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null)
  const [showPaywall, setShowPaywall] = useState(false)
  const [mediaUrlCopied, setMediaUrlCopied] = useState(false)
  const [codeContent, setCodeContent] = useState('')
  const [activeCodeBlogPostId, setActiveCodeBlogPostId] = useState<string | null>(null)
  const [activeCodeBlogPostTitle, setActiveCodeBlogPostTitle] = useState<string>('')
  const [versions, setVersions] = useState<Version[]>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null)
  const [codeSaving, setCodeSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editSrcDoc, setEditSrcDoc] = useState('')
  const [editSaving, setEditSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [editOutdated, setEditOutdated] = useState(false)
  const [showStructurePanel, setShowStructurePanel] = useState(false)
  const [chatHidden, setChatHidden] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<string | null>(null)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
  const verifyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPagesRef = useRef<Page[]>([])
  // Track slugs explicitly deleted in this session so the merge doesn't bring them back
  const deletedSlugsRef = useRef<Set<string>>(new Set())
  const editIframeRef = useRef<HTMLIFrameElement>(null)
  const editBaseHtmlRef = useRef<string>('')
  // Throttle inline-edit version snapshots: at most one every 90s during active
  // editing. Without this, every 800ms autosave pause inserted a full-pages snapshot
  // into project_versions — the main source of DB bloat + Disk IO during inline edits.
  const lastInlineVersionRef = useRef<number>(0)

  // Ref mirrors of "site-wide" state fields. Used by buildSiteConfig to avoid
  // stale closures when saveState is fired from async callbacks/timers.
  const faviconUrlRef = useRef<string>('')
  const blogHeaderHtmlRef = useRef<string>('')
  const blogSidebarBannerUrlRef = useRef<string>('')
  const blogSidebarBannerLinkRef = useRef<string>('')
  const projectContextRef = useRef<{ businessName?: string; businessType?: string; services?: string[]; language?: string; targetAudience?: string }>({})
  const sharedCssRef = useRef<string>('')
  const sharedNavHtmlRef = useRef<string>('')
  const sharedFooterHtmlRef = useRef<string>('')

  const activePage = pages.find(p => p.slug === activeSlug) || pages[0]

  useEffect(() => { latestPagesRef.current = pages }, [pages])
  useEffect(() => { faviconUrlRef.current = faviconUrl }, [faviconUrl])

  // Credits balance: load on mount + refresh every 30s + on visibility change
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const tok = session?.access_token
        if (!tok) return
        const r = await fetch('/api/credits', { headers: { Authorization: `Bearer ${tok}` } })
        if (!r.ok) return
        const j = await r.json()
        if (!cancelled) setCreditsBalance(typeof j.balance === 'number' ? j.balance : 0)
      } catch { /* ignore */ }
    }
    refresh()
    // Poll every 60s (was 30s) — saves ~50% API calls on long sessions
    const interval = setInterval(() => {
      // Skip polling when tab is hidden — browser may throttle anyway, and we
      // refresh on visibility change below.
      if (document.visibilityState === 'hidden') return
      refresh()
    }, 60000)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { blogHeaderHtmlRef.current = blogHeaderHtml }, [blogHeaderHtml])
  useEffect(() => { injectPointsRef.current = injectPoints }, [injectPoints])
  // Sync GTM ID from inject_points when they load
  useEffect(() => {
    const m = (injectPoints.head ?? '').match(/GTM-[A-Z0-9]+/)
    if (m) setGtmId(m[0])
  }, [injectPoints.head])
  useEffect(() => { blogSidebarBannerUrlRef.current = blogSidebarBannerUrl }, [blogSidebarBannerUrl])
  useEffect(() => { blogSidebarBannerLinkRef.current = blogSidebarBannerLink }, [blogSidebarBannerLink])
  useEffect(() => { projectContextRef.current = projectContext }, [projectContext])

  // Inject Google Fonts into parent document for Design System preview
  useEffect(() => {
    const { fontFamilies } = generateDesignSystemCSS(designSystem)
    if (fontFamilies.length === 0) return
    const id = 'fact-ds-preview-fonts'
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    const families = fontFamilies.map(f => `family=${f.replace(/ /g,'+')}:wght@300;400;500;600;700;800`).join('&')
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
  }, [designSystem])

  // Typing animation: animate new assistant messages character-by-character
  useEffect(() => {
    messages.forEach(msg => {
      if (msg.role !== 'assistant' || !msg.content) return
      if (typedMsgIds.current.has(msg.id)) return     // already animated or old message
      if (typingTimers.current[msg.id]) return         // already animating
      typedMsgIds.current.add(msg.id)
      const full = msg.content
      let i = 0
      // Initialize with empty so render immediately shows animated version
      setTypingContent(prev => ({ ...prev, [msg.id]: '' }))
      typingTimers.current[msg.id] = setInterval(() => {
        i = Math.min(i + 6, full.length)               // 6 chars/tick @ 18ms ≈ fast typing
        setTypingContent(prev => ({ ...prev, [msg.id]: full.slice(0, i) }))
        if (i >= full.length) {
          clearInterval(typingTimers.current[msg.id])
          delete typingTimers.current[msg.id]
        }
      }, 18)
    })
  }, [messages])

  // Cleanup typing timers on unmount
  useEffect(() => {
    return () => { Object.values(typingTimers.current).forEach(clearInterval) }
  }, [])

  // Re-analyze SEO whenever pages or blog posts change or the SEO tab is opened.
  // Blog posts are rendered to their published HTML form (same builder used by the
  // /preview and custom-domain routes) so the SEO checks see exactly what Google sees.
  // Guard: skip expensive regex parsing unless the user is actually on the SEO tab.
  useEffect(() => {
    if (pages.length === 0) return
    if (viewMode !== 'seo') return
    // Build "virtual pages" for blog posts using the same renderer as the live site
    const homePage = pages.find(p => p.slug === 'home')
    const homeHtml = homePage?.html ?? ''
    const siteNav = sharedNavHtmlRef.current || homeHtml.match(/<nav[\s\S]*?<\/nav>/i)?.[0] || ''
    const footerMatches = [...homeHtml.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
    const siteFooter = sharedFooterHtmlRef.current || (footerMatches.length > 0 ? footerMatches[footerMatches.length - 1][0] : '')
    const siteStyle = (homeHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n')
    const lang = projectContext?.language
      || homeHtml.match(/<html[^>]+lang=["']([^"']{2})/i)?.[1]
      || 'it'
    const sidebarBanner = blogSidebarBannerUrl
      ? { url: blogSidebarBannerUrl, link: blogSidebarBannerLink }
      : null
    const baseUrl = `/preview/${projectSlug}`

    const blogPagesForSeo = blogPosts
      .filter(bp => bp.status === 'published' && bp.content_html)  // only analyze published posts with content
      .map(bp => {
        const post: BlogServePost = {
          id: bp.id,
          title: bp.title,
          slug: bp.slug,
          excerpt: bp.excerpt ?? '',
          featured_image: bp.featured_image,
          published_at: bp.published_at,
          categories: bp.categories ?? [],
          tags: bp.tags ?? [],
          content_html: bp.content_html ?? '',
          seo_title: bp.seo_title,
          seo_description: bp.seo_description,
          author: bp.author,
        }
        const html = buildBlogPostPage(post, baseUrl, siteNav, siteFooter, siteStyle, lang, sidebarBanner)
        return {
          slug: `blog/${bp.slug}`,         // prefix to avoid collision with regular page slugs
          name: `📝 ${bp.title}`,           // prefixed in dropdown so it's recognizable
          html,
        }
      })

    setSeoAnalyses(analyzeAllPages([...pages, ...blogPagesForSeo], { faviconUrl: faviconUrlRef.current || undefined, siteUrl: publicBaseUrl || undefined }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, viewMode, blogPosts, projectSlug, projectContext, blogSidebarBannerUrl, blogSidebarBannerLink])

  // Elapsed-seconds timer — ticks every second while an agent is running
  useEffect(() => {
    if (!loading) { setElapsedSeconds(0); return }
    loadingStartRef.current = Date.now()
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - loadingStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [loading])

  // Set editSrcDoc when entering edit mode (don't depend on pages to avoid iframe reload)
  useEffect(() => {
    if (viewMode === 'edit' && activePage && projectSlug) {
      editBaseHtmlRef.current = activePage.html
      setEditSrcDoc(injectBase(activePage.html, projectSlug, sharedNavHtmlRef.current || undefined, sharedFooterHtmlRef.current || undefined, sharedCssRef.current || undefined, faviconUrlRef.current || undefined))
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
      if (e.data?.type === 'fact-structure-state') {
        setShowStructurePanel(e.data.active === true)
        return
      }
      if (e.data?.type === 'fact-block') {
        setInlineActiveBlock(e.data.tag ?? '')
        return
      }
      if (e.data?.type === 'fact-style') {
        setInlineActiveBlock(e.data.block ?? 'P')
        setInlineFontName(e.data.fontName ?? '')
        setInlineFontSizePt(e.data.fontSizePt ?? null)
        if (inlineColorInputRef.current && e.data.color) inlineColorInputRef.current.value = e.data.color
        return
      }
      // Preview: visible blocks (automatic, IntersectionObserver)
      if (e.data?.type === 'fact-visible-blocks') {
        setVisibleBlocks((e.data.blocks ?? []) as string[])
        return
      }
      // Preview: explicit click → higher-priority selection
      if (e.data?.type === 'fact-element-click') {
        setPreviewSelection({
          blockSelector: e.data.blockSelector ?? '',
          anchorText: e.data.anchorText ?? '',
          outerHtml: (e.data.outerHtml ?? '').slice(0, 400),
          timestamp: Date.now(),
        })
        return
      }
      if (e.data?.type !== 'html-change' || !activePage) return
      const newHtml = e.data.html as string
      // Keep editBaseHtmlRef in sync so AI-change detection doesn't false-positive
      editBaseHtmlRef.current = newHtml
      let newPages = latestPagesRef.current.map(p =>
        p.slug === activePage.slug ? { ...p, html: newHtml } : p
      )
      // If the user edited the nav on a non-home page, propagate that nav change to home
      // so it becomes the shared source of truth. Without this, the save would extract
      // home's unchanged nav and revert the edit on the next render.
      if (activePage.slug !== 'home' && sharedNavHtmlRef.current) {
        const newNavMatch = newHtml.match(/<nav[\s\S]*?<\/nav>/i)
        if (newNavMatch && newNavMatch[0] !== sharedNavHtmlRef.current) {
          const newNav = newNavMatch[0]
          newPages = newPages.map(p => {
            if (p.slug !== 'home' || !/<nav[\s\S]*?<\/nav>/i.test(p.html)) return p
            return { ...p, html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, newNav) }
          })
        }
      }
      setPages(newPages)
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(async () => {
        setEditSaving('saving')
        const curPages = latestPagesRef.current
        // Version snapshot is throttled to once per 90s during continuous inline
        // editing — the autosave below persists every change, so no data is lost;
        // versions are only undo checkpoints and don't need per-keystroke granularity.
        const now = Date.now()
        if (now - lastInlineVersionRef.current > 90_000) {
          lastInlineVersionRef.current = now
          void createVersion('Modifica inline', curPages)
        }
        // Fast-path: inline edits only touch page HTML → save pages-only via RPC
        // (no full-blob read/write). Falls back to full saveState on any error.
        const ok = await savePagesInline(curPages)
        if (ok) {
          setEditSaving('saved')
          setTimeout(() => setEditSaving(prev => prev === 'saved' ? 'idle' : prev), 2000)
        } else {
          setEditSaving('failed')
        }
      }, 2000)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activePage?.slug, messages, versions])

  // Listen for inline edits on blog post content
  // Sync article keyword chips when post changes
  useEffect(() => {
    if (selectedPost?.tags?.length) {
      setArticleKeywordChips(selectedPost.tags)
    } else {
      setArticleKeywordChips([])
    }
  }, [selectedPost?.id])

  useEffect(() => {
    if (viewMode !== 'blog' || !selectedPost) return
    const handleBlogMessage = (e: MessageEvent) => {
      if (e.data?.type === 'fact-block') {
        setBlogActiveBlock(e.data.tag ?? '')
        return
      }
      if (e.data?.type === 'fact-style') {
        setBlogActiveBlock(e.data.block ?? 'P')
        setBlogFontName(e.data.fontName ?? '')
        setBlogFontSizePt(e.data.fontSizePt ?? null)
        setBlogLineHeight(e.data.lineHeight ?? '')
        if (blogColorInputRef.current && e.data.color) blogColorInputRef.current.value = e.data.color
        return
      }
      if (e.data?.type !== 'html-change') return
      const newHtml = e.data.html as string
      blogBaseHtmlRef.current = newHtml
      // Extract the innermost .blog-post-content innerHTML to avoid
      // accumulating wrappers on every save/reload cycle
      let contentHtml = ''
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(newHtml, 'text/html')
        const allContent = doc.querySelectorAll('.blog-post-content')
        const innermost = allContent.length > 0 ? allContent[allContent.length - 1] : null
        if (innermost) {
          contentHtml = innermost.innerHTML.trim()
        } else {
          const bodyMatch = newHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
          contentHtml = bodyMatch ? bodyMatch[1].trim() : newHtml
        }
      } catch {
        const bodyMatch = newHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
        contentHtml = bodyMatch ? bodyMatch[1].trim() : newHtml
      }
      console.log('[parent-blog] html-change received, contentHtml length:', contentHtml.length, 'preview:', contentHtml.length > 200 ? contentHtml.slice(0, 200) + '…' : contentHtml)
      setSelectedPost(prev => prev ? { ...prev, content_html: contentHtml } : prev)
      // Push snapshot to history unless this html-change came from undo/redo itself
      if (!undoOpInFlightRef.current) {
        const h = blogHistoryRef.current
        if (h.stack[h.index] !== contentHtml) {
          h.stack = h.stack.slice(0, h.index + 1)
          h.stack.push(contentHtml)
          if (h.stack.length > 50) h.stack.shift()
          else h.index++
        }
      } else {
        undoOpInFlightRef.current = false
      }
      // Capture the post id this content belongs to, so a fast post switch
      // doesn't save the new content under the previous post's id
      const targetPostId = selectedPost.id
      // Track pending save so beforeunload can flush it
      blogPendingSaveRef.current = { postId: targetPostId, contentHtml }
      console.log('[parent-blog] autosave scheduled in 800ms for post', selectedPost.id)
      if (blogAutoSaveTimer.current) clearTimeout(blogAutoSaveTimer.current)
      blogAutoSaveTimer.current = setTimeout(async () => {
        console.log('[parent-blog] autosave FIRING for post', targetPostId, 'content length:', contentHtml.length)
        setBlogSaving('saving')
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) { console.error('[parent-blog] no auth token'); setBlogSaving('failed'); return }
        try {
          const res = await fetch(`/api/blog-posts/${targetPostId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ content_html: contentHtml }),
            keepalive: true,
            cache: 'no-store',
          })
          if (!res.ok) {
            const errBody = await res.text().catch(() => '')
            console.error('[blog-autosave] FAILED', res.status, errBody)
            setBlogSaving('failed')
            return
          }
          console.log('[blog-autosave] ok', targetPostId, contentHtml.length, 'chars')
          blogPendingSaveRef.current = null
          setBlogSaving('saved')
          setTimeout(() => setBlogSaving(prev => prev === 'saved' ? 'idle' : prev), 2000)
        } catch (err) {
          console.error('[blog-autosave] network error:', err)
          setBlogSaving('failed')
        }
      }, 800)
    }
    window.addEventListener('message', handleBlogMessage)
    return () => window.removeEventListener('message', handleBlogMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedPost?.id])

  const saveBlogHeader = async () => {
    setBlogHeaderSaving('saving')
    const { data: { session: sc } } = await supabase.auth.getSession()
    if (!sc) { setBlogHeaderSaving('idle'); return }
    // Merge blog_header_html into existing site_config
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existingConfig = (proj?.site_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: { ...existingConfig, blog_header_html: blogHeaderHtml },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBlogHeaderSaving('saved')
    setTimeout(() => setBlogHeaderSaving('idle'), 2000)
  }

  const saveInjectPoints = async (updated: Record<string, string>) => {
    setInjectPointsSaving('saving')
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existingConfig = (proj?.site_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: { ...existingConfig, inject_points: updated },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setInjectPointsSaving('saved')
    setTimeout(() => setInjectPointsSaving('idle'), 2000)
  }

  const saveBlogSidebarBanner = async (url = blogSidebarBannerUrl, link = blogSidebarBannerLink) => {
    setBlogSidebarBannerSaving('saving')
    const { data: { session: sc } } = await supabase.auth.getSession()
    if (!sc) { setBlogSidebarBannerSaving('idle'); return }
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existingConfig = (proj?.site_config ?? {}) as Record<string, unknown>
    const { error } = await supabase.from('projects').update({
      site_config: { ...existingConfig, blog_sidebar_banner: { url, link } },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) {
      console.error('[banner] save failed:', error)
      setBlogSidebarBannerSaving('idle')
      return
    }
    setBlogSidebarBannerSaving('saved')
    setTimeout(() => setBlogSidebarBannerSaving('idle'), 2000)
  }

  const saveBrevoIntegration = async () => {
    setBrevoSaving('saving')
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existing = (proj?.site_config ?? {}) as Record<string, unknown>
    const existingIntegrations = (existing.integrations ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: {
        ...existing,
        integrations: {
          ...existingIntegrations,
          brevo: { apiKey: brevoApiKey.trim() }
        }
      },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBrevoSaving('saved')
    setTimeout(() => setBrevoSaving('idle'), 2000)
  }

  const saveContactFormConfig = async () => {
    setCfSaving('saving')
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existing = (proj?.site_config ?? {}) as Record<string, unknown>
    const existingComponents = (existing.components_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: {
        ...existing,
        components_config: {
          ...existingComponents,
          contact_form: {
            admin_email:            cfAdminEmail.trim(),
            confirm_message:        cfConfirmMsg.trim(),
            confirm_email_message:  cfConfirmEmailMsg.trim(),
            redirect_url:           cfRedirectUrl.trim(),
            turnstile_site_key:     cfTurnstileSiteKey.trim(),
          }
        }
      },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setCfSaving('saved')
    setTimeout(() => setCfSaving('idle'), 2000)
  }

  const saveCrmConfig = async () => {
    setCrmSaving('saving')
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existing = (proj?.site_config ?? {}) as Record<string, unknown>
    const existingComponents = (existing.components_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: {
        ...existing,
        components_config: {
          ...existingComponents,
          crm_form: {
            admin_email:           crmAdminEmail.trim(),
            confirm_message:       crmConfirmMsg.trim(),
            confirm_email_message: crmConfirmEmailMsg.trim(),
            redirect_url:          crmRedirectUrl.trim(),
            turnstile_site_key:    crmTurnstileSiteKey.trim(),
          }
        }
      },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setCrmSaving('saved')
    setTimeout(() => setCrmSaving('idle'), 2000)
  }

  const saveSuggestConfig = async () => {
    setSuggestSaving('saving')
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existing = (proj?.site_config ?? {}) as Record<string, unknown>
    const existingComponents = (existing.components_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: {
        ...existing,
        components_config: {
          ...existingComponents,
          suggest_form: {
            admin_email:           suggestAdminEmail.trim(),
            confirm_message:       suggestConfirmMsg.trim(),
            confirm_email_message: suggestConfirmEmailMsg.trim(),
            redirect_url:          suggestRedirectUrl.trim(),
            turnstile_site_key:    suggestTurnstileSiteKey.trim(),
          }
        }
      },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setSuggestSaving('saved')
    setTimeout(() => setSuggestSaving('idle'), 2000)
  }

  const testBrevoConnection = async () => {
    setBrevoTesting('testing')
    try {
      const r = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': brevoApiKey.trim(), 'accept': 'application/json' }
      })
      setBrevoTesting(r.ok ? 'ok' : 'error')
    } catch {
      setBrevoTesting('error')
    }
    setTimeout(() => setBrevoTesting('idle'), 3000)
  }

  // Auto-save banner 1.5s after the user stops typing (prevents data loss if they don't click Salva)
  const bannerAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!projectSlug) return // not mounted yet
    if (bannerAutoSaveTimer.current) clearTimeout(bannerAutoSaveTimer.current)
    bannerAutoSaveTimer.current = setTimeout(() => {
      // Only auto-save if at least one field is set
      if (blogSidebarBannerUrl || blogSidebarBannerLink) {
        saveBlogSidebarBanner(blogSidebarBannerUrl, blogSidebarBannerLink)
      }
    }, 1500)
    return () => { if (bannerAutoSaveTimer.current) clearTimeout(bannerAutoSaveTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogSidebarBannerUrl, blogSidebarBannerLink])

  useEffect(() => {
    if (viewMode === 'code' && activePage && !activeCodeBlogPostId) {
      setCodeContent(activePage.html)
      setCodeSaving('idle')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug, viewMode])

  // Reset iframe path tracking when user explicitly changes page/mode
  useEffect(() => { setPreviewIframePath(null) }, [activeSlug, viewMode])

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

  // Scroll to bottom whenever new messages arrive during an active session.
  // NOTE: React 19 automatic batching means that when handleSend fires, both
  // the user message AND the assistant placeholder are batched into a single
  // render — so messages.length can jump by 2 at once. The old `=== 1` check
  // was therefore never true and the chat stopped auto-scrolling. Fixed: scroll
  // whenever messages.length grows and we already had messages (prev > 0).
  const prevMsgLenRef = useRef(0)
  // Reset prevMsgLenRef whenever the project changes (or on mount / Strict Mode remount)
  // so the initial-history scroll always fires correctly.
  useEffect(() => { prevMsgLenRef.current = 0 }, [id])
  useEffect(() => {
    const prev = prevMsgLenRef.current
    prevMsgLenRef.current = messages.length
    if (messages.length === 0) return
    if (prev === 0) {
      // Initial history load: scroll directly on the container (more reliable than
      // scrollIntoView) and defer one frame so images/content have a chance to render.
      // A second deferred scroll at 300ms catches images that load after the first frame.
      const el = chatListRef.current
      if (el) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
        setTimeout(() => { el.scrollTop = el.scrollHeight }, 300)
      }
    } else if (messages.length > prev) {
      // New message(s) added during active session: smooth scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll position after older messages are prepended (fires before paint → no jump)
  useLayoutEffect(() => {
    if (chatScrollAnchor.current && chatListRef.current) {
      const el = chatListRef.current
      el.scrollTop = el.scrollHeight - chatScrollAnchor.current.height + chatScrollAnchor.current.top
      chatScrollAnchor.current = null
    }
  }, [visibleMsgCount])

  // IntersectionObserver: load older messages progressively when user scrolls to top sentinel
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const container = chatListRef.current
    if (!sentinel || !container) return
    if (visibleMsgCount >= messages.length) return // nothing more to load

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && sentinelReadyRef.current) {
          // Save anchor so scroll position doesn't jump when prepending messages
          chatScrollAnchor.current = { height: container.scrollHeight, top: container.scrollTop }
          setVisibleMsgCount(c => Math.min(c + CHAT_MORE, messages.length))
        }
      },
      { root: container, rootMargin: '0px', threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleMsgCount, messages.length])

  // Re-arm sentinel guard after initial load (500ms) so the observer
  // doesn't fire while the page is still scrolling to the bottom
  useEffect(() => {
    sentinelReadyRef.current = false
    const t = setTimeout(() => { sentinelReadyRef.current = true }, 500)
    return () => clearTimeout(t)
  }, [messages.length]) // re-arm on every messages change

  const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
  const publicBaseUrl = (() => {
    if (!projectSlug) return ''
    // Root project ALWAYS canonicalises to www, even if its custom_domain is the apex.
    const rootProject = process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
    if (rootProject && projectSlug === rootProject) return `https://www.${ROOT_DOMAIN}`
    // Always use www for apex domains (no subdomain prefix)
    const wwwDomain = customDomain && !customDomain.startsWith('www.') ? `www.${customDomain}` : customDomain
    if (customDomainStatus === 'verified' && customDomain) return `https://${wwwDomain}`
    if (typeof window === 'undefined') return ''
    const host = window.location.host
    const isProduction = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)
    return isProduction
      ? `https://myweb.${ROOT_DOMAIN}/${projectSlug}`
      : `${window.location.origin}/preview/${projectSlug}`
  })()
  const publicUrl = (() => {
    if (!publicBaseUrl) return ''
    // Code editor with a blog post open → show the blog post URL
    if (viewMode === 'code' && activeCodeBlogPostId) {
      const bp = blogPosts.find(p => p.id === activeCodeBlogPostId)
      if (bp) {
        const pp = bp.categories?.[0] ? `blog/${slugify(bp.categories[0])}/${bp.slug}` : `blog/${bp.slug}`
        return `${publicBaseUrl}/${pp}`
      }
    }
    // Blog editor with a post selected
    if (viewMode === 'blog' && selectedPost) {
      const cat = selectedPost.categories?.[0] ? slugify(selectedPost.categories[0]) : null
      return cat
        ? `${publicBaseUrl}/blog/${cat}/${selectedPost.slug}`
        : `${publicBaseUrl}/blog/${selectedPost.slug}`
    }
    // Preview: reflect internal navigation (user clicked links in iframe)
    if (viewMode === 'preview' && previewIframePath && previewIframePath !== '/') {
      return `${publicBaseUrl}${previewIframePath}`
    }
    // Default: active page
    return activeSlug === 'home' ? publicBaseUrl : `${publicBaseUrl}/${activeSlug}`
  })()

  const copyUrl = async () => {
    if (!publicUrl) return
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Reusable: AI-generate alt/title/caption/description for an uploaded image
  // in the project's language. Called by ALL upload paths so every image in the
  // media library has SEO metadata populated automatically.
  const generateAndSaveImageMeta = async (path: string, imageUrl: string) => {
    try {
      const detectedLang: string =
        projectContext?.language ||
        latestPagesRef.current[0]?.html?.match(/<html[^>]+lang=["']([^"']{2})/i)?.[1] ||
        'it'
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const r = await fetch('/api/generate-image-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageUrl, context: { ...projectContext, language: detectedLang } }),
      })
      if (!r.ok) {
        console.error('[image-meta] generation failed:', r.status)
        return
      }
      const meta = await r.json()
      if (!meta) return
      const newMeta = {
        ...mediaMeta,
        [path]: {
          alt: meta.alt ?? '',
          title: meta.title ?? '',
          caption: meta.caption ?? '',
          description: meta.description ?? '',
        },
      }
      setMediaMeta(newMeta)
      saveState(messages, latestPagesRef.current, versions, newMeta)
      console.log('[image-meta] generated for', path, meta)
    } catch (err) {
      console.error('[image-meta] error:', err)
    }
  }

  // Same as above but only fills EMPTY fields — used by the ✨ wand button in media panel
  const generateImageMetaFillEmpty = async (path: string, imageUrl: string) => {
    setMediaAiGenerating(true)
    try {
      const detectedLang: string =
        projectContext?.language ||
        latestPagesRef.current[0]?.html?.match(/<html[^>]+lang=["']([^"']{2})/i)?.[1] ||
        'it'
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const r = await fetch('/api/generate-image-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageUrl, context: { ...projectContext, language: detectedLang } }),
      })
      if (!r.ok) return
      const meta = await r.json()
      if (!meta) return
      const existing = mediaMeta[path] ?? {}
      const newMeta = {
        ...mediaMeta,
        [path]: {
          alt:         existing.alt         || meta.alt         || '',
          title:       existing.title       || meta.title       || '',
          caption:     existing.caption     || meta.caption     || '',
          description: existing.description || meta.description || '',
        },
      }
      setMediaMeta(newMeta)
      saveState(messages, latestPagesRef.current, versions, newMeta)
    } catch (err) {
      console.error('[image-meta wand] error:', err)
    } finally {
      setMediaAiGenerating(false)
    }
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
    // Generate SEO meta in background (non-blocking)
    generateAndSaveImageMeta(path, imageUrl)
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
      const config = project.site_config as { html?: string; pages?: Page[]; messages?: Message[]; versions?: Version[]; media?: Record<string, MediaMeta>; context?: { businessName?: string; businessType?: string; services?: string[]; language?: string; targetAudience?: string }; blog_header_html?: string; blog_sidebar_banner?: { url: string; link: string } } | null
      if (config?.context) setProjectContext(config.context)
      let loadedPages: Page[] = []
      if (config?.pages?.length) loadedPages = config.pages
      else if (config?.html) loadedPages = [{ slug: 'home', name: 'Home', html: config.html }]
      // Strip any editor artefacts left over from previous edit sessions before fix
      const rawPages = loadedPages
      loadedPages = loadedPages.map(p => ({ ...p, html: stripEditorArtifacts(p.html) }))
      // If any page was dirty (accumulated <base> tags etc.), persist the cleaned version immediately
      const wasDirty = loadedPages.some((p, i) => p.html !== rawPages[i]?.html)
      // Remove any static "blog" page — the blog is served dynamically from blog_posts.
      // A static page with slug "blog" is always shadowed by the dynamic route and causes confusion.
      const hasBlogPage = loadedPages.some(p => p.slug === 'blog')
      loadedPages = loadedPages.filter(p => p.slug !== 'blog')
      // If it had a blog page, make sure the nav link ./blog is still there
      if (hasBlogPage && loadedPages.length > 0 && !hasBlogNavLink(loadedPages)) {
        const lang = (config?.context as { language?: string } | undefined)?.language ?? 'it'
        loadedPages = addBlogLinkToNav(loadedPages, lang === 'es' ? 'Blog' : 'Blog')
      }
      // Fase 1: backfill blocks for pages that don't have them yet (migration).
      // Run in background after load — non-blocking, saves on next agent action.
      loadedPages = loadedPages.map(p => {
        if (p.blocks) return p  // already split
        const blocks = splitHtmlIntoBlocks(p.html)
        return blocks ? { ...p, blocks } : p
      })
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) {
        // Mark all historical messages as already typed — no animation for history
        ;(config.messages as Message[]).forEach((m: Message) => typedMsgIds.current.add(m.id))
        setMessages(config.messages)
        // Reset visible count so we show last N messages of the loaded history
        setVisibleMsgCount(20)
      }
      // Versions now live in the project_versions table — load the lightweight
      // list (no page HTML; that's fetched lazily on restore). Falls back to any
      // legacy config.versions for projects not yet migrated.
      void (async () => {
        const { data: vrows, error: vErr } = await supabase
          .from('project_versions')
          .select('id, summary, created_at')
          .eq('project_id', id)
          .order('created_at', { ascending: false })
          .limit(30)
        if (!vErr && vrows && vrows.length > 0) {
          setVersions(vrows.map(r => ({ id: r.id, timestamp: r.created_at, summary: r.summary })))
        } else if (config?.versions) {
          // Pre-migration fallback (these still carry pages, but that's fine for display)
          setVersions(config.versions as Version[])
        }
      })()
      if (config?.media) setMediaMeta(config.media)
      if ((config as any)?.favicon_url) setFaviconUrl((config as any).favicon_url as string)
      setBlogHeaderHtml(config?.blog_header_html ?? '')
      // Load inject_points (migrate legacy blog_newsletter_html if present)
      const existingIp = ((config as any)?.inject_points ?? {}) as Record<string, string>
      const legacyNewsletter = (config as any)?.blog_newsletter_html as string | undefined
      if (legacyNewsletter && !existingIp.blog_post_bottom) {
        existingIp.blog_post_bottom = legacyNewsletter
      }
      setInjectPoints(existingIp)
      injectPointsRef.current = existingIp
      setBlogSidebarBannerUrl(config?.blog_sidebar_banner?.url ?? '')
      setBlogSidebarBannerLink(config?.blog_sidebar_banner?.link ?? '')
      setRedirects(((config as any)?.redirects ?? []) as Array<{ from: string; to: string }>)
      setDefaultOgImage(((config as any)?.default_og_image ?? '') as string)
      // Load Brevo integration settings
      const integrations = ((config as any)?.integrations ?? {}) as Record<string, unknown>
      const brevo = (integrations.brevo ?? {}) as Record<string, unknown>
      setBrevoApiKey((brevo.apiKey as string) ?? '')
      setBrevoListId(String(brevo.listId ?? ''))
      // Load contact form component config
      const cfConfig = ((config as any)?.components_config?.contact_form ?? {}) as Record<string, unknown>
      setCfAdminEmail((cfConfig.admin_email as string) ?? '')
      setCfConfirmMsg((cfConfig.confirm_message as string) ?? '')
      setCfConfirmEmailMsg((cfConfig.confirm_email_message as string) ?? '')
      setCfRedirectUrl((cfConfig.redirect_url as string) ?? '')
      setCfTurnstileSiteKey((cfConfig.turnstile_site_key as string) ?? '')
      // Load CRM form config
      const crmConfig = ((config as any)?.components_config?.crm_form ?? {}) as Record<string, unknown>
      setCrmAdminEmail((crmConfig.admin_email as string) ?? '')
      setCrmConfirmMsg((crmConfig.confirm_message as string) ?? '')
      setCrmConfirmEmailMsg((crmConfig.confirm_email_message as string) ?? '')
      setCrmRedirectUrl((crmConfig.redirect_url as string) ?? '')
      setCrmTurnstileSiteKey((crmConfig.turnstile_site_key as string) ?? '')
      // Load suggest module form config
      const suggestConfig = ((config as any)?.components_config?.suggest_form ?? {}) as Record<string, unknown>
      setSuggestAdminEmail((suggestConfig.admin_email as string) ?? '')
      setSuggestConfirmMsg((suggestConfig.confirm_message as string) ?? '')
      setSuggestConfirmEmailMsg((suggestConfig.confirm_email_message as string) ?? '')
      setSuggestRedirectUrl((suggestConfig.redirect_url as string) ?? '')
      setSuggestTurnstileSiteKey((suggestConfig.turnstile_site_key as string) ?? '')
      // Load shared nav / footer refs for editor preview injection.
      // One-time migration: if missing, extract from home page and persist immediately.
      if ((config as any)?.shared_nav_html) {
        sharedNavHtmlRef.current = (config as any).shared_nav_html as string
      }
      if ((config as any)?.shared_footer_html) {
        sharedFooterHtmlRef.current = (config as any).shared_footer_html as string
      }
      if (!((config as any)?.shared_nav_html) && loadedPages.length > 0) {
        const homeForNav = loadedPages.find(p => p.slug === 'home') ?? loadedPages[0]
        const navMatch = homeForNav.html.match(/<nav[\s\S]*?<\/nav>/i)
        const footerMatch = homeForNav.html.match(/<footer[\s\S]*?<\/footer>/i)
        if (navMatch || footerMatch) {
          if (navMatch) sharedNavHtmlRef.current = navMatch[0]
          if (footerMatch) sharedFooterHtmlRef.current = footerMatch[0]
          supabase.from('projects').update({
            site_config: {
              ...(config ?? {}),
              ...(navMatch ? { shared_nav_html: navMatch[0] } : {}),
              ...(footerMatch ? { shared_footer_html: footerMatch[0] } : {}),
            },
          }).eq('id', id).then(() => console.log('[shared_nav/footer] migrated from home page'))
        }
      }

      if ((config as any)?.shared_css) {
        sharedCssRef.current = (config as any).shared_css as string
      } else if (loadedPages.length > 0) {
        // One-time migration: extract shared_css from home page and save it
        const homeForMigration = loadedPages.find(p => p.slug === 'home') ?? loadedPages[0]
        const cssBlocks = homeForMigration.html.match(/<style[\s\S]*?<\/style>/gi) ?? []
        const extractedCss = cssBlocks.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
        if (extractedCss) {
          sharedCssRef.current = extractedCss
          supabase.from('projects').update({
            site_config: { ...(config ?? {}), shared_css: extractedCss },
          }).eq('id', id).then(() => console.log('[shared_css] migrated from home page'))
        }
      }
      if ((config as any)?.designSystem) {
        // Merge with defaults so new keys (e.g. 'li') are always present
        // even for projects saved before the key was added
        const ds: DesignSystem = { ...DEFAULT_DESIGN_SYSTEM, ...(config as any).designSystem }
        // Ensure each tag's config is complete (new props may be missing in old saved data)
        for (const tag of Object.keys(DEFAULT_DESIGN_SYSTEM) as Array<keyof DesignSystem>) {
          if (tag === 'bullet') {
            ds.bullet = { ...DEFAULT_DESIGN_SYSTEM.bullet, ...(ds.bullet ?? {}) }
          } else {
            ds[tag] = { ...DEFAULT_DESIGN_SYSTEM[tag as keyof Omit<DesignSystem,'bullet'>], ...(ds[tag as keyof Omit<DesignSystem,'bullet'>] ?? {}) } as any
          }
        }
        setDesignSystem(ds)
        // Re-inject design system CSS into loaded pages (ensures freshness)
        loadedPages = applyDesignSystemToPages(ds, loadedPages)
        setPages(loadedPages)
      }
      // Auto-heal: if pages had accumulated <base> tags, save the cleaned HTML immediately
      if (wasDirty) {
        const cleanConfig = { ...(config ?? {}), pages: loadedPages }
        await supabase.from('projects').update({
          site_config: cleanConfig,
          updated_at: new Date().toISOString(),
        }).eq('id', id)
      }

      // Load SEO keywords
      if ((config as any)?.keywords?.length) {
        setSeoKeywords((config as any).keywords)
      }
    }
    load()
  }, [id])

  // Insert a version snapshot into the project_versions table (append-only — does
  // NOT touch site_config, so it adds zero overhead to the hot save path).
  // Returns the updated lightweight list (no page HTML) for the history panel.
  // Fire-and-forget on the DB write so it never blocks the chat/edit flow.
  const createVersion = async (summary: string, currentPages: Page[]): Promise<Version[]> => {
    if (currentPages.length === 0) return versions
    const optimistic: Version = { id: `v_${Date.now()}`, timestamp: new Date().toISOString(), summary }
    const updated = [optimistic, ...versions].slice(0, 30)
    setVersions(updated)   // optimistic UI — list shows the new entry immediately
    try {
      const { data, error } = await supabase
        .from('project_versions')
        .insert({ project_id: id, summary, pages: currentPages })
        .select('id, summary, created_at')
        .single()
      if (error) { console.error('[createVersion] insert error:', error.message); return updated }
      // Replace the optimistic id with the real DB id (so restore can fetch it)
      if (data) {
        setVersions(prev => prev.map(v => v.id === optimistic.id
          ? { id: data.id, timestamp: data.created_at, summary: data.summary }
          : v))
      }
      // Prune old versions beyond the most-recent 30, server-side
      void supabase.rpc('prune_project_versions', { p_project_id: id, p_keep: 10 })
        .then(({ error: pErr }: { error: { message: string } | null }) => {
          if (pErr) console.warn('[createVersion] prune skipped:', pErr.message)
        })
    } catch (e) {
      console.error('[createVersion] unexpected:', e)
    }
    return updated
  }

  /**
   * Builds the full site_config by READ-MERGING with the current DB state.
   * This preserves ANY top-level field we don't explicitly know about
   * (e.g. published_pages, future fields, fields written by other endpoints).
   * Critical: prevents data loss when saveState runs after pages are edited.
   */
  const buildSiteConfig = async (
    newPages: Page[],
    newMessages: Message[],
    newMedia: Record<string, MediaMeta>,
  ): Promise<Record<string, unknown>> => {
    const { data: existing } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const base = (existing?.site_config ?? {}) as Record<string, unknown>
    const cfg: Record<string, unknown> = {
      ...base,
      pages: newPages,
      messages: newMessages,
      media: newMedia,
    }
    // Versions now live in the project_versions table — never persist them inside
    // site_config (this is what was bloating the blob and burning Disk IO). Strip
    // any legacy versions key so pre-migration projects get cleaned on next save.
    delete cfg.versions
    // Use ref mirrors to avoid stale closures on rapid state updates
    const fav = faviconUrlRef.current
    const bhh = blogHeaderHtmlRef.current
    const bsbUrl = blogSidebarBannerUrlRef.current
    const bsbLink = blogSidebarBannerLinkRef.current
    const ctx = projectContextRef.current
    const ip = injectPointsRef.current
    if (fav) cfg.favicon_url = fav
    if (bhh) cfg.blog_header_html = bhh
    if (Object.keys(ip).length > 0) cfg.inject_points = ip
    if (bsbUrl || bsbLink) cfg.blog_sidebar_banner = { url: bsbUrl, link: bsbLink }
    if (ctx && Object.keys(ctx).length > 0) cfg.context = ctx
    const css = sharedCssRef.current
    if (css) cfg.shared_css = css

    // ── Shared nav + footer: extract from home page, store as single source of truth.
    // At serve time (preview.ts) these are injected into every page, replacing
    // their per-page copies — so editing nav/footer on home propagates everywhere
    // automatically without any per-page sync loop.
    const homePage = newPages.find(p => p.slug === 'home') ?? newPages[0]
    if (homePage?.html) {
      const navMatch = homePage.html.match(/<nav[\s\S]*?<\/nav>/i)
      if (navMatch) {
        cfg.shared_nav_html = navMatch[0]
        sharedNavHtmlRef.current = navMatch[0]
      }
      const footerMatch = homePage.html.match(/<footer[\s\S]*?<\/footer>/i)
      if (footerMatch) {
        cfg.shared_footer_html = footerMatch[0]
        sharedFooterHtmlRef.current = footerMatch[0]
      }
    }

    return cfg
  }

  // Fast-path save for the INLINE EDITOR only (high-frequency content edits).
  // Updates ONLY pages + shared nav/footer via the save_inline_pages RPC, which
  // uses jsonb_set inside Postgres — the full site_config never crosses the network
  // (no SELECT) and only the pages key is written. ~12MB → ~1-2MB per inline save.
  //
  // Safe because inline editing never changes messages/media/structure/settings —
  // only page HTML (+ nav/footer derived from home). jsonb_set preserves every other
  // key. Structural changes (chat, add/delete page) still use the full saveState below.
  // Falls back to saveState if the RPC isn't deployed or errors.
  const savePagesInline = async (newPages: Page[]): Promise<boolean> => {
    if (!Array.isArray(newPages) || newPages.length === 0) return false
    // Re-derive shared nav/footer from home (mirrors buildSiteConfig's logic)
    const homePage = newPages.find(p => p.slug === 'home') ?? newPages[0]
    let navJson: string | null = null
    let footerJson: string | null = null
    if (homePage?.html) {
      const navMatch = homePage.html.match(/<nav[\s\S]*?<\/nav>/i)
      if (navMatch) { navJson = navMatch[0]; sharedNavHtmlRef.current = navMatch[0] }
      const footerMatch = homePage.html.match(/<footer[\s\S]*?<\/footer>/i)
      if (footerMatch) { footerJson = footerMatch[0]; sharedFooterHtmlRef.current = footerMatch[0] }
    }
    try {
      const { error } = await supabase.rpc('save_inline_pages', {
        p_id: id,
        p_pages: newPages,
        p_shared_nav: navJson,
        p_shared_footer: footerJson,
      })
      if (error) {
        console.warn('[savePagesInline] RPC failed, falling back to saveState:', error.message)
        return saveState(messages, newPages)
      }
      latestPagesRef.current = newPages
      return true
    } catch (e) {
      console.warn('[savePagesInline] unexpected, falling back to saveState:', e)
      return saveState(messages, newPages)
    }
  }

  // NOTE: `_newVersions` is accepted for backwards-compat with existing call sites
  // but intentionally ignored — versions are persisted to the project_versions table
  // by createVersion(), never inside site_config.
  const saveState = async (newMessages: Message[], newPages: Page[], _newVersions?: Version[], newMedia?: Record<string, MediaMeta>): Promise<boolean> => {
    // Safety guard: never overwrite existing pages with an empty array
    if (!Array.isArray(newPages) || (newPages.length === 0 && latestPagesRef.current.length > 0)) {
      console.warn('saveState: skipping — refusing to overwrite existing pages with empty array')
      return false
    }
    const med = newMedia ?? mediaMeta

    // ── Collaborative merge ────────────────────────────────────────────────────
    // Two users on the same account can work concurrently. Without merging,
    // whoever saves last overwrites the other's new pages.
    // Strategy: read current DB state → keep any pages that exist in DB but NOT
    // in newPages (added by another session), except those explicitly deleted
    // in this session (tracked in deletedSlugsRef).
    let pagesToSave = newPages
    try {
      const { data: fresh } = await supabase
        .from('projects')
        .select('site_config')
        .eq('id', id)
        .single()
      const dbPages = ((fresh?.site_config as Record<string, unknown>)?.pages ?? []) as Page[]
      if (Array.isArray(dbPages) && dbPages.length > 0) {
        const ourSlugs = new Set(newPages.map(p => p.slug))
        const deleted  = deletedSlugsRef.current
        // Pages in DB that we've never seen in this session → preserve them
        const extraPages = dbPages.filter(p => !ourSlugs.has(p.slug) && !deleted.has(p.slug))
        if (extraPages.length > 0) {
          console.log('[saveState] merging', extraPages.length, 'page(s) added by another session:', extraPages.map(p => p.slug))
          pagesToSave = [...newPages, ...extraPages]
        }
      }
    } catch (mergeErr) {
      console.warn('[saveState] merge read failed (non-fatal):', mergeErr)
    }
    // ── End collaborative merge ────────────────────────────────────────────────

    const merged = await buildSiteConfig(pagesToSave, newMessages, med)

    // Retry up to 3 times with exponential back-off (1s, 2s) so transient
    // Supabase timeouts don't silently lose messages.
    const MAX_ATTEMPTS = 3
    let lastErr: string | null = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { error } = await supabase.from('projects').update({
        site_config: merged,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (!error) {
        if (attempt > 1) console.log(`[saveState] ok on attempt ${attempt}`)
        console.log('[saveState] ok', newPages.length, 'pages,', newMessages.length, 'msgs')
        return true
      }
      lastErr = error.message
      console.error(`[saveState] supabase error (attempt ${attempt}/${MAX_ATTEMPTS}):`, lastErr)
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 1000))
    }
    // All attempts failed — show a visible warning so the user knows to retry
    console.error('[saveState] all attempts failed:', lastErr)
    setSaveError('⚠️ Salvataggio non riuscito — riprova o ricarica la pagina')
    return false
  }

  // Force any pending blog autosave to fire NOW.
  // Called on post switch, back-to-list, and tab/visibility change so the
  // user never loses changes by leaving within the 800ms debounce window.
  const flushBlogSave = async () => {
    // CRITICAL: read the LATEST state directly from the iframe DOM.
    // The iframe has its own 400ms input-debounce before sending html-change,
    // so blogPendingSaveRef may not yet reflect the user's last keystroke.
    // Pulling directly from the editable element avoids that race.
    const iframe = blogIframeRef.current
    if (iframe?.contentDocument && selectedPost?.id) {
      try {
        const editable = iframe.contentDocument.querySelector('.blog-post-content')
        if (editable) {
          const latestContent = (editable as HTMLElement).innerHTML.trim()
          blogPendingSaveRef.current = { postId: selectedPost.id, contentHtml: latestContent }
        }
      } catch (err) {
        console.warn('[parent-blog] flush: could not read iframe DOM:', err)
      }
    }
    const pending = blogPendingSaveRef.current
    if (!pending) return
    if (blogAutoSaveTimer.current) {
      clearTimeout(blogAutoSaveTimer.current)
      blogAutoSaveTimer.current = null
    }
    blogPendingSaveRef.current = null
    console.log('[parent-blog] FLUSHING pending save for', pending.postId, 'length:', pending.contentHtml.length)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { console.error('[parent-blog] flush: no token'); setBlogSaving('failed'); return }
    setBlogSaving('saving')
    try {
      const res = await fetch(`/api/blog-posts/${pending.postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content_html: pending.contentHtml }),
        keepalive: true,
        cache: 'no-store',
      })
      if (!res.ok) {
        console.error('[parent-blog] flush FAILED', res.status, await res.text().catch(() => ''))
        setBlogSaving('failed')
        return
      }
      console.log('[parent-blog] flush ok')
      setBlogSaving('saved')
      setTimeout(() => setBlogSaving(prev => prev === 'saved' ? 'idle' : prev), 1500)
    } catch (err) {
      console.error('[parent-blog] flush error:', err)
      setBlogSaving('failed')
    }
  }

  // Flush on tab visibility change (user switches tab or minimises window)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushBlogSave()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Custom undo/redo for the blog editor. Restores a previous content snapshot
  // by setting the iframe's editable innerHTML directly — bypasses the buggy
  // browser execCommand('undo') which can leave duplicated content.
  const blogUndo = () => {
    const h = blogHistoryRef.current
    if (h.index <= 0) return
    h.index--
    const prev = h.stack[h.index]
    // Set flag so if html-change somehow fires we don't double-push to history.
    // BUT: fact-set-content sets innerHTML directly without calling triggerSave,
    // so html-change never arrives and the flag would stay true forever — blocking
    // the next real user edit from being recorded. Reset it after a tick.
    undoOpInFlightRef.current = true
    setTimeout(() => { undoOpInFlightRef.current = false }, 50)
    blogIframeRef.current?.contentWindow?.postMessage({ type: 'fact-set-content', html: prev }, '*')
    // Cancel any pending autosave — it would re-save the content we just undid.
    // Then schedule a fresh save of the restored content so the DB stays in sync.
    if (blogAutoSaveTimer.current) { clearTimeout(blogAutoSaveTimer.current); blogAutoSaveTimer.current = null }
    if (selectedPost?.id) blogPendingSaveRef.current = { postId: selectedPost.id, contentHtml: prev }
    // Small delay lets the iframe render before flushBlogSave reads the DOM
    blogAutoSaveTimer.current = setTimeout(() => { flushBlogSave() }, 400)
  }
  const blogRedo = () => {
    const h = blogHistoryRef.current
    if (h.index >= h.stack.length - 1) return
    h.index++
    const next = h.stack[h.index]
    undoOpInFlightRef.current = true
    setTimeout(() => { undoOpInFlightRef.current = false }, 50)
    blogIframeRef.current?.contentWindow?.postMessage({ type: 'fact-set-content', html: next }, '*')
    if (blogAutoSaveTimer.current) { clearTimeout(blogAutoSaveTimer.current); blogAutoSaveTimer.current = null }
    if (selectedPost?.id) blogPendingSaveRef.current = { postId: selectedPost.id, contentHtml: next }
    blogAutoSaveTimer.current = setTimeout(() => { flushBlogSave() }, 400)
  }

  const loadMedia = async () => {
    setMediaLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const folder = `${session.user.id}/${id}`
      const { data: files, error } = await supabase.storage.from('project-assets').list(folder, {
        sortBy: { column: 'created_at', order: 'desc' },
        limit: 1000,
      })
      if (error) { console.error('[loadMedia] storage error:', error.message); return }
      if (!files) return
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
    } catch (err) {
      console.error('[loadMedia] unexpected error:', err)
    } finally {
      setMediaLoading(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'media') loadMedia()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, id])

  // Load media when the image picker modal opens
  useEffect(() => {
    if (mediaPickerTarget) loadMedia()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaPickerTarget])

  const loadBlogPosts = useCallback(async () => {
    setBlogLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setBlogLoading(false); return }
      const res = await fetch(`/api/blog-posts?projectId=${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      setBlogPosts(json.posts ?? [])
    } catch (e) {
      console.error('loadBlogPosts error:', e)
    } finally {
      setBlogLoading(false)
    }
  }, [id])

  /**
   * Generates 3 demo blog articles and saves them as published to blog_posts.
   * Called automatically after create_site when the user requested a blog.
   * Runs silently in the background — UI shows posts in sidebar once done.
   */
  const autoSeedBlogPosts = useCallback(async (token: string) => {
    const lang = projectContext.language ?? 'it'
    const businessType = projectContext.businessType ?? ''

    // Pick 3 generic topics relevant to any business — agent will localise them
    const topics = lang === 'en'
      ? ['Getting started guide', 'Top tips for success', 'Industry news and trends']
      : lang === 'es'
      ? ['Guía para comenzar', 'Consejos para el éxito', 'Noticias del sector']
      : ['Guida introduttiva', 'Consigli per il successo', 'News e tendenze del settore']

    const context = {
      businessName: projectContext.businessName,
      businessType,
      services: projectContext.services,
      language: lang,
      targetAudience: projectContext.targetAudience,
    }

    const created: BlogPost[] = []
    for (const topic of topics) {
      try {
        const genRes = await fetch('/api/generate-blog-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ topic, context }),
        })
        if (!genRes.ok) continue
        const post = await genRes.json()

        const saveRes = await fetch('/api/blog-posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId: id, ...post }),
        })
        if (!saveRes.ok) continue
        const saved = await saveRes.json()
        if (!saved.post) continue

        // Publish immediately so they appear in the blog preview
        const publishRes = await fetch(`/api/blog-posts/${saved.post.id}?action=publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const published = publishRes.ok ? await publishRes.json() : null
        created.push(published?.post ?? saved.post)
      } catch (e) {
        console.warn('[autoSeedBlogPosts] error for topic:', topic, e)
      }
    }

    if (created.length > 0) {
      setBlogPosts(prev => {
        const existingIds = new Set(prev.map(p => p.id))
        return [...prev, ...created.filter(p => !existingIds.has(p.id))]
      })
    }
  }, [id, projectContext])

  useEffect(() => {
    // Always load blog posts on first render so the URL dropdown shows articles
    // in preview/edit/code modes without needing to switch to blog mode first
    if (blogPosts.length === 0) loadBlogPosts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewMode !== 'blog' && viewMode !== 'code') return
    if (viewMode === 'blog') {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          const meta = session.user.user_metadata ?? {}
          setUserFullName([meta.first_name, meta.last_name].filter(Boolean).join(' ') || session.user.email?.split('@')[0] || '')
        }
      })
    }
    if (blogPosts.length === 0) loadBlogPosts()
    // Auto-aggiungi link Blog al menu se non presente
    if (pages.length > 0 && !hasBlogNavLink(pages)) {
      const lang = projectContext.language ?? 'it'
      const label = lang === 'es' ? 'Blog' : lang === 'en' ? 'Blog' : 'Blog'
      const updated = addBlogLinkToNav(pages, label)
      setPages(updated)
      saveState(messages, updated)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  const [faviconSaving, setFaviconSaving] = useState<'idle' | 'saving' | 'saved'>('idle')

  const saveFaviconUrl = async (url: string) => {
    setFaviconSaving('saving')
    try {
      const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
      const existing = (proj?.site_config ?? {}) as Record<string, unknown>
      const { error } = await supabase.from('projects').update({
        site_config: { ...existing, favicon_url: url },
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
      setFaviconUrl(url)
      faviconUrlRef.current = url
      setFaviconSaving('saved')
      setTimeout(() => setFaviconSaving('idle'), 2000)
    } catch (err) {
      console.error('[saveFaviconUrl]', err)
      setFaviconSaving('idle')
    }
  }

  const saveDesignSystem = async (ds: DesignSystem) => {
    setDesignSaving('saving')
    const updatedPages = applyDesignSystemToPages(ds, latestPagesRef.current)
    setPages(updatedPages)
    latestPagesRef.current = updatedPages
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const currentConfig = (proj?.site_config ?? {}) as Record<string, unknown>

    // Merge Design System CSS into shared_css (single source of truth) so blog posts
    // inherit it too. Uses the shared lib which strips ALL prior DS blocks with a
    // properly-escaped regex (the old inline regex left the */ markers unescaped, so
    // stale blocks accumulated and overrode the new one by source order).
    const existingSharedCss = (typeof currentConfig.shared_css === 'string' ? currentConfig.shared_css : '') as string
    const newSharedCss = syncSharedCssWithDesignSystem(existingSharedCss, ds as unknown as LibDesignSystem)

    await supabase.from('projects').update({
      site_config: { ...currentConfig, pages: updatedPages, designSystem: ds, shared_css: newSharedCss },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setDesignSaving('saved')
    setTimeout(() => setDesignSaving('idle'), 2500)
  }

  /** Resize/crop image to 1200×630 (OG format) via Canvas, upload to storage, return new URL */
  const resizeToOgFormat = async (sourceUrl: string): Promise<string> => {
    const OG_W = 1200, OG_H = 630
    return new Promise((resolve, reject) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = async () => {
        // Skip if already correct dimensions
        if (img.naturalWidth === OG_W && img.naturalHeight === OG_H) { resolve(sourceUrl); return }

        // Center-crop to 1200×630
        const canvas = document.createElement('canvas')
        canvas.width = OG_W; canvas.height = OG_H
        const ctx = canvas.getContext('2d')!
        const srcRatio = img.naturalWidth / img.naturalHeight
        const tgtRatio = OG_W / OG_H
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight
        if (srcRatio > tgtRatio) { sw = img.naturalHeight * tgtRatio; sx = (img.naturalWidth - sw) / 2 }
        else { sh = img.naturalWidth / tgtRatio; sy = (img.naturalHeight - sh) / 2 }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OG_W, OG_H)

        canvas.toBlob(async (blob) => {
          if (!blob) { resolve(sourceUrl); return }
          try {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) { resolve(sourceUrl); return }
            const path = `${session.user.id}/${id}/og-${Date.now()}.jpg`
            const file = new File([blob], 'og.jpg', { type: 'image/jpeg' })
            const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: 'image/jpeg', upsert: false })
            if (error) { resolve(sourceUrl); return }
            const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
            resolve(publicUrl)
          } catch { resolve(sourceUrl) }
        }, 'image/jpeg', 0.92)
      }
      img.onerror = () => resolve(sourceUrl)
      img.src = sourceUrl
    })
  }

  const savePageOgImage = async (slug: string, url: string) => {
    if (!url) {
      // Removing OG image
      const next = pages.map(p => p.slug === slug ? { ...p, og_image: '' } : p)
      setPages(next)
      await saveState(messages, next)
      return
    }
    // Auto-resize to 1200×630 before saving
    const ogUrl = await resizeToOgFormat(url)
    const next = pages.map(p => p.slug === slug ? { ...p, og_image: ogUrl } : p)
    setPages(next)
    await saveState(messages, next)
  }

  // Site-wide default OG image — fallback for pages without their own (servePublished).
  const saveDefaultOgImage = async (url: string) => {
    const finalUrl = url ? await resizeToOgFormat(url) : ''
    setDefaultOgImage(finalUrl)
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const currentConfig = (proj?.site_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: { ...currentConfig, default_og_image: finalUrl },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  }

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
    // Persist media meta immediately (short debounce to batch rapid field edits)
    // Don't share the page autosave timer — media meta must save independently
    if (mediaSaveTimer.current) clearTimeout(mediaSaveTimer.current)
    mediaSaveTimer.current = setTimeout(() => {
      saveState(messages, latestPagesRef.current, versions, updated)
    }, 600)
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

  // ── SEO Fix ───────────────────────────────────────────────────────────────────

  /** Checks that can be auto-fixed for blog posts (maps to seo_title / seo_description). */
  const BLOG_FIXABLE_CHECKS: CheckId[] = ['title', 'meta-description', 'open-graph']

  /** Fixes a SEO check on a blog post by updating seo_title / seo_description via API. */
  const fixBlogPostCheck = async (checkId: CheckId, blogPageSlug: string): Promise<boolean> => {
    if (!BLOG_FIXABLE_CHECKS.includes(checkId)) {
      setSeoFixError('Questo check non è correggibile automaticamente per gli articoli blog — modifica i campi SEO nel tab Blog.')
      return false
    }
    const postSlug = blogPageSlug.replace(/^blog\//, '')
    const post = blogPosts.find(p => p.slug === postSlug)
    if (!post) { setSeoFixError(`Articolo non trovato: ${postSlug}`); return false }

    // Build the rendered HTML so the SEO agent sees exactly what the live page looks like
    const homeHtml = pages.find(p => p.slug === 'home')?.html ?? ''
    const siteNav = sharedNavHtmlRef.current || homeHtml.match(/<nav[\s\S]*?<\/nav>/i)?.[0] || ''
    const footerMatches = [...homeHtml.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
    const siteFooter = sharedFooterHtmlRef.current || (footerMatches.length > 0 ? footerMatches[footerMatches.length - 1][0] : '')
    const siteStyle = (homeHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n')
    const lang = (projectContext?.language as string | undefined) || 'it'
    const baseUrl = customDomain ? `https://${customDomain}` : `/preview/${projectSlug}`
    const blogServePost: BlogServePost = {
      id: post.id, title: post.title, slug: post.slug,
      excerpt: post.excerpt ?? '', featured_image: post.featured_image,
      published_at: post.published_at, categories: post.categories ?? [],
      tags: post.tags ?? [], content_html: post.content_html ?? '',
      seo_title: post.seo_title, seo_description: post.seo_description, author: post.author,
    }
    const renderedHtml = buildBlogPostPage(blogServePost, baseUrl, siteNav, siteFooter, siteStyle, lang, null)

    // Find the checkResult from the rendered HTML
    const analyses = analyzeAllPages([{ slug: blogPageSlug, name: post.title, html: renderedHtml }])
    const checkResult = analyses[0]?.results.find(r => r.checkId === checkId)
    if (!checkResult) { setSeoFixError('Check non trovato nella pagina renderizzata.'); return false }
    if (checkResult.status === 'pass') return true

    const { data: { session: seoSession } } = await supabase.auth.getSession()
    const seoToken = seoSession?.access_token
    if (!seoToken) { setSeoFixError('Sessione scaduta'); return false }

    const resp = await fetch('/api/seo-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seoToken}` },
      body: JSON.stringify({
        projectId: id,
        pageSlug: blogPageSlug,
        checkId,
        checkResult,
        pages: [{ slug: blogPageSlug, name: post.title, html: renderedHtml }],
        customDomain: customDomain || null,
        projectMedia: mediaItems.map(m => ({ url: m.url, name: m.name })),
        blogPost: { id: post.id, slug: post.slug },
      }),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      setSeoFixError(`Errore ${resp.status}: ${errText.slice(0, 120)}`)
      return false
    }
    if (!resp.body) { setSeoFixError('Risposta vuota dal server'); return false }

    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'error') { setSeoFixError(msg.error); return false }
          if (msg.type === 'done' && msg.result?.updatedBlogPost) {
            const upd = msg.result.updatedBlogPost as { id: string; seo_title?: string; seo_description?: string }
            // Update local state — the SEO useEffect will re-analyze automatically
            setBlogPosts(prev => prev.map(p => p.id === upd.id ? { ...p, ...upd } : p))
            return true
          }
        } catch { /* skip malformed */ }
      }
    }
    return false
  }

  /** Fixes a single check on a single page. Returns true on success. */
  const fixOnePage = async (checkId: CheckId, pageSlug: string): Promise<boolean> => {
    // Blog posts have a different fix flow
    if (pageSlug.startsWith('blog/')) return fixBlogPostCheck(checkId, pageSlug)

    const analyses = analyzeAllPages(latestPagesRef.current, { faviconUrl: faviconUrlRef.current || undefined, siteUrl: publicBaseUrl || undefined })
    const pageAnalysis = analyses.find(a => a.pageSlug === pageSlug)
    const checkResult = pageAnalysis?.results.find(r => r.checkId === checkId)
    if (!checkResult) {
      console.error('[SEO Fix] checkResult not found for', checkId, pageSlug)
      setSeoFixError(`Check "${checkId}" non trovato per la pagina "${pageSlug}"`)
      return false
    }

    const { data: { session: seoSession } } = await supabase.auth.getSession()
    const seoToken = seoSession?.access_token
    if (!seoToken) { setSeoFixError('Sessione scaduta'); return false }
    const resp = await fetch('/api/seo-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seoToken}` },
      body: JSON.stringify({
        projectId: id,
        pageSlug,
        checkId,
        checkResult,
        pages: latestPagesRef.current,
        customDomain: customDomain || null,
        // Pass uploaded image URLs so the SEO agent can use them for og:image
        projectMedia: mediaItems.map(m => ({ url: m.url, name: m.name })),
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      setSeoFixError(`Errore ${resp.status}: ${errText.slice(0, 120)}`)
      return false
    }
    if (!resp.body) { setSeoFixError('Risposta vuota dal server'); return false }

    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'error') { setSeoFixError(msg.error); return false }
          if (msg.type === 'done' && msg.result?.updatedPages) {
            const updated = msg.result.updatedPages as Page[]
            setPages(updated)
            latestPagesRef.current = updated
            setSeoAnalyses(analyzeAllPages(updated, { faviconUrl: faviconUrlRef.current || undefined, siteUrl: publicBaseUrl || undefined }))
            await saveState(messages, updated, versions)
            return true
          }
        } catch { /* skip malformed lines */ }
      }
    }
    return false
  }

  /**
   * Fixes a check. If scopeSlugs has multiple entries, applies the fix
   * to every page in the list that is currently failing that check.
   */
  const fixCheck = async (checkId: CheckId, scopeSlugs: string | string[]) => {
    if (seoFixingRef.current) return
    seoFixingRef.current = true
    setSeoFixing(checkId)
    setSeoFixError(null)
    try {
      const slugs = Array.isArray(scopeSlugs) ? scopeSlugs : [scopeSlugs]
      for (const slug of slugs) {
        // Skip pages where the check already passes (re-analyze from latest)
        const currentAnalyses = analyzeAllPages(latestPagesRef.current, { faviconUrl: faviconUrlRef.current || undefined, siteUrl: publicBaseUrl || undefined })
        const result = currentAnalyses.find(a => a.pageSlug === slug)?.results.find(r => r.checkId === checkId)
        if (!result || result.status === 'pass') continue
        const ok = await fixOnePage(checkId, slug)
        if (!ok) break // stop on first error
      }
    } catch (err) {
      console.error('[SEO Fix] Unexpected error:', err)
      setSeoFixError(String(err))
    } finally {
      seoFixingRef.current = false
      setSeoFixing(null)
    }
  }

  /** Fixes all failing checks on the given page scope (one page or all). */
  const fixAllFailing = async (scopeSlugs: string | string[]) => {
    if (seoFixingRef.current) return
    const slugs = Array.isArray(scopeSlugs) ? scopeSlugs : [scopeSlugs]
    // Collect all unique failing check IDs across the scope
    const analyses = analyzeAllPages(latestPagesRef.current, { faviconUrl: faviconUrlRef.current || undefined, siteUrl: publicBaseUrl || undefined })
    const failingChecks = [...new Set(
      slugs.flatMap(slug =>
        analyses.find(a => a.pageSlug === slug)?.results
          .filter(r => r.status !== 'pass')
          .map(r => r.checkId) ?? []
      )
    )]
    for (const checkId of failingChecks) {
      await fixCheck(checkId, slugs)
    }
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
    script.textContent = buildInlineEditScript(pages.map(p => ({ slug: p.slug, name: p.name })))
    iframe.contentDocument.body.appendChild(script)
    // Inject structure overlay script (activates on demand via postMessage)
    const structScript = iframe.contentDocument.createElement('script')
    structScript.id = 'fact-struct-script'
    structScript.textContent = buildStructureOverlayScript()
    iframe.contentDocument.body.appendChild(structScript)
  }

  const FRIENDLY_ERROR = 'Qualcosa è andato storto durante l\'elaborazione. Le tue modifiche al sito sono al sicuro — puoi riprovare con lo stesso messaggio.'

  /**
   * Apply a single find/replace edit with smart fallbacks:
   * 1. Exact string match
   * 2. Whitespace-normalized match (handles line-break / indent differences)
   * 3. Image src swap: if find contains <img and a src="...", replace only that src
   * Returns [newHtml, applied: boolean]
   */
  const applyEdit = (html: string, find: string, replace: string): [string, boolean] => {
    // 1. Exact match
    if (html.includes(find)) return [html.replace(find, replace), true]

    // 2. Whitespace-normalized match
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
    const normHtml = normalize(html)
    const normFind = normalize(find)
    if (normHtml.includes(normFind)) {
      // Rebuild: find the actual substring in original html by locating surrounding anchors
      const idx = normHtml.indexOf(normFind)
      // Map normalized index back to original (approximate — good enough for most cases)
      let origIdx = 0, normIdx = 0
      while (normIdx < idx && origIdx < html.length) {
        if (html[origIdx].match(/\s/) && (origIdx === 0 || html[origIdx - 1].match(/\s/))) { origIdx++; continue }
        origIdx++; normIdx++
      }
      // Find the end of the match in original
      let origEnd = origIdx, normEnd = normIdx
      while (normEnd < normIdx + normFind.length && origEnd < html.length) {
        if (html[origEnd].match(/\s/) && (origEnd === 0 || html[origEnd - 1].match(/\s/))) { origEnd++; continue }
        origEnd++; normEnd++
      }
      return [html.slice(0, origIdx) + replace + html.slice(origEnd), true]
    }

    // 3. Landmark match: if find is a large block starting with an HTML tag that has
    //    a unique id="..." or a distinctive class="...", locate that element in the
    //    actual HTML by its opening tag and replace the whole block up to its closing tag.
    //    Handles pricing/hero/features sections where whitespace mapping breaks down.
    const landmarkTagMatch = find.trimStart().match(/^<(\w+)([^>]*)>/)
    if (landmarkTagMatch) {
      const tag = landmarkTagMatch[1]          // e.g. "section", "div"
      const attrs = landmarkTagMatch[2]        // e.g. ' class="pricing" id="pricing"'
      // Extract id first (most unique), then class
      const idMatch = attrs.match(/id=["']([^"']+)["']/)
      const classMatch = attrs.match(/class=["']([^"']+)["']/)
      const landmarks = [
        idMatch    ? `id="${idMatch[1]}"`              : null,
        idMatch    ? `id='${idMatch[1]}'`              : null,
        classMatch ? `class="${classMatch[1]}"`        : null,
        classMatch ? `class='${classMatch[1]}'`        : null,
        // Also try first class only (e.g. "pricing" from "pricing recommended")
        classMatch ? `class="${classMatch[1].split(' ')[0]}"` : null,
      ].filter(Boolean) as string[]

      for (const landmark of landmarks) {
        // Find the opening tag in the actual HTML
        const openRe = new RegExp(`<${tag}[^>]*${landmark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`, 'i')
        const openMatch = html.match(openRe)
        if (!openMatch || openMatch.index === undefined) continue

        // Walk forward to find the matching closing tag (handles nesting)
        const start = openMatch.index
        let depth = 0
        let i = start
        const openTagRe  = new RegExp(`<${tag}[\\s>]`, 'gi')
        const closeTagRe = new RegExp(`</${tag}>`, 'gi')
        openTagRe.lastIndex  = start
        closeTagRe.lastIndex = start

        // Simple stack-based scan
        let end = -1
        const scan = html.slice(start)
        let d = 0
        let pos = 0
        while (pos < scan.length) {
          const nextOpen  = scan.indexOf(`<${tag}`,   pos)
          const nextClose = scan.indexOf(`</${tag}>`, pos)
          if (nextClose === -1) break
          if (nextOpen !== -1 && nextOpen < nextClose) {
            d++; pos = nextOpen + 1
          } else {
            d--; pos = nextClose + `</${tag}>`.length
            if (d === 0) { end = start + pos; break }
          }
        }
        if (end === -1) continue
        return [html.slice(0, start) + replace + html.slice(end), true]
      }
    }

    // 4. Image src swap: extract old src from find, new src from replace, swap in html
    const imgSrcRe = /src=["']([^"']+)["']/
    if (find.includes('<img') && replace.includes('<img')) {
      const oldSrc = find.match(imgSrcRe)?.[1]
      const newSrc = replace.match(imgSrcRe)?.[1]
      if (oldSrc && newSrc && html.includes(oldSrc)) {
        return [html.split(oldSrc).join(newSrc), true]
      }
      // Also handle background-image / CSS url() in style attributes
      const oldUrl = find.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
      const newUrl = replace.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
      if (oldUrl && newUrl && html.includes(oldUrl)) {
        return [html.split(oldUrl).join(newUrl), true]
      }
    }

    // 5. src-only swap even without <img context (background-image, video poster, etc.)
    const oldSrc = find.match(imgSrcRe)?.[1]
    const newSrc = replace.match(imgSrcRe)?.[1]
    if (oldSrc && newSrc && html.includes(oldSrc)) {
      return [html.split(oldSrc).join(newSrc), true]
    }

    // 6. Closing-tag anchor: when the find contains a closing structural tag (</main>,
    //    </body>, </footer>) that exists in the HTML, anchor the replace on the LAST
    //    occurrence of that tag. Handles "insert section before </main>" patterns where
    //    the agent correctly uses structural anchors but surrounding whitespace differs.
    const closingTagMatch = find.match(/<\/(main|body|footer|article|section)>/i)
    if (closingTagMatch) {
      const anchor = closingTagMatch[0].toLowerCase() // e.g. </main>
      const lastIdx = html.toLowerCase().lastIndexOf(anchor)
      if (lastIdx !== -1) {
        // Build a replace that swaps the anchor with whatever is in the replace string
        // that ends with the same anchor
        const replaceLower = replace.toLowerCase()
        if (replaceLower.includes(anchor)) {
          // Use the replace as-is, applied at the last occurrence of the anchor in html
          const before = html.slice(0, lastIdx)
          const after = html.slice(lastIdx + anchor.length)
          // Preserve original case of anchor in the replace
          const newReplace = replace.slice(0, replace.toLowerCase().lastIndexOf(anchor)) + anchor + replace.slice(replace.toLowerCase().lastIndexOf(anchor) + anchor.length)
          return [before + newReplace + after, true]
        }
      }
    }

    return [html, false]
  }

  /**
   * Applies a selector-based section operation to an HTML page.
   * The selector syntax mirrors the SECTION INDEX format: tag#id.firstClass
   * Supports op: 'insert_after' | 'insert_before' | 'replace'
   */
  const applySectionOp = (
    html: string,
    op: 'insert_after' | 'insert_before' | 'replace',
    target: string,
    newHtml: string
  ): [string, boolean] => {
    // Parse selector → tag, id, firstClass
    // Examples: "section#pricing", "footer.site-footer", "header", "section#hero.hero-section"
    const selectorRe = /^([a-z][a-z0-9]*)?(?:#([^.#\s]+))?(?:\.([^\s#]+))?$/i
    const sm = target.trim().match(selectorRe)
    if (!sm) return [html, false]
    const tagM   = sm[1] || ''
    const idM    = sm[2] || ''
    const classM = sm[3] ? sm[3].split('.')[0] : ''  // first class segment

    // Build opening-tag regex
    // Must match the opening tag that contains id and/or class
    const tagPat = tagM || '[a-z][a-z0-9]*'
    const parts: string[] = [`<(${tagPat})`]
    if (idM)    parts.push(`(?=[^>]*id=["']${idM}["'])`)
    if (classM) parts.push(`(?=[^>]*class=["'][^"']*${classM}[^"']*["'])`)
    parts.push('[^>]*>')
    const openRe = new RegExp(parts.join(''), 'i')

    const openMatch = html.match(openRe)
    if (!openMatch || openMatch.index === undefined) return [html, false]

    // Determine actual tag name from the match (handles wildcard case)
    const actualTag = openMatch[1]?.toLowerCase() || tagM.toLowerCase()
    if (!actualTag) return [html, false]

    const start = openMatch.index

    // Depth-aware walk to find matching closing tag
    const scan  = html.slice(start)
    let d = 0, pos = 0, end = -1
    const openStr  = `<${actualTag}`
    const closeStr = `</${actualTag}>`
    while (pos < scan.length) {
      const nextOpen  = scan.indexOf(openStr,  pos)
      const nextClose = scan.indexOf(closeStr, pos)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        d++; pos = nextOpen + 1
      } else {
        d--; pos = nextClose + closeStr.length
        if (d === 0) { end = start + pos; break }
      }
    }
    if (end === -1) return [html, false]

    if (op === 'replace') {
      return [html.slice(0, start) + newHtml + html.slice(end), true]
    } else if (op === 'insert_before') {
      return [html.slice(0, start) + newHtml + '\n' + html.slice(start), true]
    } else {  // insert_after
      return [html.slice(0, end) + '\n' + newHtml + html.slice(end), true]
    }
  }

  // Extract CSS custom properties (:root vars) from home page — used by ComponentCanvas
  // to give the component agent the site's design tokens.
  const designTokensCss = useMemo(() => {
    const home = pages.find(p => p.slug === 'home') ?? pages[0]
    if (!home) return ''
    const styleMatch = home.html.match(/<style[\s\S]*?<\/style>/i)
    if (!styleMatch) return ''
    const rootMatch = styleMatch[0].match(/:root\s*\{([^}]+)\}/)
    if (!rootMatch) return ''
    return `:root {\n${rootMatch[1].trim()}\n}`
  }, [pages])

  // Ref that will be wired to handleSend after it's defined (avoids hoisting issue)
  const handleSendRef = useRef<((e: React.FormEvent, retryOverride?: { input: string; images: string[] }) => void) | null>(null)

  // Called by ComponentCanvas when user clicks "Inserisci in pagina".
  // Pre-fills the main chat with the component HTML and auto-submits.
  const handleInsertComponent = useCallback((html: string) => {
    const pageName = (pages.find(p => p.slug === activeSlug) ?? pages[0])?.name ?? 'home'
    const msg = `Inserisci questo blocco HTML nella pagina "${pageName}", prima del footer:\n\`\`\`html\n${html}\n\`\`\``
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent
    handleSendRef.current?.(fakeEvent, { input: msg, images: [] })
    setShowComponentCanvas(false)
  }, [pages, activeSlug])

  const handleSend = async (e: React.FormEvent, retryOverride?: { input: string; images: string[] }) => {
    e.preventDefault()
    const effectiveInput = retryOverride?.input ?? input
    const effectiveImages = retryOverride?.images ?? attachedImages
    if ((!effectiveInput.trim() && effectiveImages.length === 0) || loading) return

    // Helper: builds the API-facing content (includes image URLs for the agent, hidden from UI)
    const buildApiContent = (text: string, imgs: string[]) =>
      (text.trim() || 'Usa queste immagini.') +
      (imgs.length ? '\n\n' + imgs.map(u => `Immagine allegata: ${u}`).join('\n') : '')

    // Se c'era una richiesta in sospeso (il clarifier aveva fatto domande), combina con la risposta
    const savedPendingRequest = pendingRequest
    if (pendingRequest) setPendingRequest(null)

    // Display content = text only; images stored separately in msg.images (rendered as thumbnails)
    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: effectiveInput.trim() || (effectiveImages.length ? '' : ''),
      timestamp: new Date().toISOString(),
      ...(effectiveImages.length ? { images: effectiveImages } : {}),
    }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    if (!retryOverride) {
      setInput('')
      setAttachedImages([])
    }

    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setLoading(true)

    const assistantId = `a_${Date.now()}`
    setLoadingMsgId(assistantId)
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

    // Build the messages list sent to the API.
    // Images are stored separately in msg.images — reconstruct the "Immagine allegata: url" lines for the agent.
    const toApiContent = (m: Message) =>
      m.images?.length
        ? buildApiContent(m.content, m.images)
        : m.content

    const apiMessages = savedPendingRequest
      ? [
          ...messages.map(m => ({ role: m.role, content: toApiContent(m) })),
          { role: 'user', content: `${savedPendingRequest}\n\n[Risposta alle domande]: ${buildApiContent(effectiveInput, effectiveImages)}` },
        ]
      : updatedMessages.map(m => ({ role: m.role, content: toApiContent(m) }))

    const { data: { session: chatSession } } = await supabase.auth.getSession()
    const chatToken = chatSession?.access_token
    if (!chatToken) { markFailed('Sessione scaduta — effettua di nuovo il login'); return }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chatToken}` },
      body: JSON.stringify({
        projectId: id,
        messages: apiMessages,
        pages,
        activePageSlug: activeSlug,
        customDomain: customDomainStatus === 'verified' ? customDomain : null,
        // Preview context for the agent (edit-only — no point for create_site):
        // - previewSelection: user explicitly clicked an element (strongest signal)
        // - visibleBlocks: blocks currently in viewport (automatic, no user action)
        // Agent uses these to target the right block without guessing.
        previewSelection: previewSelection && (Date.now() - previewSelection.timestamp < 120_000)
          ? { blockSelector: previewSelection.blockSelector, anchorText: previewSelection.anchorText, outerHtml: previewSelection.outerHtml }
          : undefined,
        visibleBlocks: visibleBlocks.length > 0 ? visibleBlocks : undefined,
        seoKeywords: seoKeywords.length > 0 ? seoKeywords : undefined,
      }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.status === 402 || error.code === 'INSUFFICIENT_CREDITS') {
        setShowPaywall(true)
        markFailed('Crediti insufficienti — ricarica per continuare')
        return
      }
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
      let streamError: string | null = null
      try {
        outer: while (true) {
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
                setMessages(prev => prev.map(m => m.id === assistantId
                  ? { ...m, progressSteps: [...(m.progressSteps ?? []), { step: msg.step, time: msg.time }] }
                  : m))
              } else if (msg.type === 'done') {
                result = msg.result
              } else if (msg.type === 'error') {
                // Store error and exit stream immediately — don't swallow in the JSON parse catch
                streamError = msg.error as string
                break outer
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
      if (streamError) {
        // Rate limit: show a clear, actionable message instead of generic error
        const rateLimitMatch = streamError.match(/RATE_LIMIT:(\d+)/)
        if (rateLimitMatch) {
          const waitSec = parseInt(rateLimitMatch[1], 10) || 30
          setMessages(prev => prev.map(m => m.id === assistantId
            ? { ...m, content: `⏳ Anthropic è al limite di richieste al minuto. Aspetta **${waitSec} secondi** e riprova — le tue modifiche sono al sicuro.`, failed: true, retryInput: retrySnapshot.input, retryImages: retrySnapshot.images }
            : m))
          setLoading(false)
          return
        }
        markFailed(streamError)
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

    if (result.requestLanguage) {
      // Pipeline is asking which language — just show the message, don't touch pages
      const msg = (result.steps as string[] | undefined)?.[0] ?? result.input?.summary ?? '⚠️ In che lingua vuoi il sito?'
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: msg } : m))
      const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: msg }]
      await supabase.from('projects').update({
        site_config: await buildSiteConfig(pages, finalMessages, mediaMeta),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      setLoading(false)
      return
    }

    if (result.requestClarification) {
      const msg = (result.steps as string[] | undefined)?.[0] ?? result.input?.summary ?? '🤔 Ho bisogno di qualche informazione in più.'
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: msg } : m))
      // Salva la richiesta originale per combinarla con la risposta
      setPendingRequest(buildApiContent(effectiveInput, effectiveImages))
      const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: msg }]
      await supabase.from('projects').update({
        site_config: await buildSiteConfig(pages, finalMessages, mediaMeta),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      setLoading(false)
      return
    }

    if (result.requestScreenshots) {
      // Pipeline detected an inspiration URL and is asking the user for screenshots
      const msg = result.input?.summary ?? '📸 Carica 2-3 screenshot del sito di ispirazione per generare un template personalizzato.'
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: msg } : m))
      const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: msg }]
      await supabase.from('projects').update({
        site_config: await buildSiteConfig(pages, finalMessages, mediaMeta),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      setLoading(false)
      return
    }

    // Fase 4: update_design normalised to edit_page with _shared_css
    const inlineSharedCss = (result.input as Record<string, unknown>)?._shared_css as string | undefined
    if (inlineSharedCss) {
      sharedCssRef.current = inlineSharedCss
      newPages = pages.map(p => ({ ...p, html: mergeSharedCssIntoPage(p.html, inlineSharedCss) }))
    }

    if (result.tool === 'update_shared_css') {
      // Design-update: apply new CSS to in-memory pages (for srcDoc preview) + save shared_css
      const newCss = result.input.shared_css
      if (newCss) {
        sharedCssRef.current = newCss
        // Apply new CSS to all pages in memory so srcDoc preview reflects the change.
        // Uses the self-contained detection so pages with their own component CSS
        // (unique layouts) only get their :root tokens synced, not stripped.
        newPages = pages.map(p => ({ ...p, html: mergeSharedCssIntoPage(p.html, newCss) }))
      }
      summary = `🎨 ${result.input.summary ?? "fatto"}`
      // Fall through to saveState below (newPages is updated)
    } else

    if (result.tool === 'create_site') {
      const rawPages = result.input.pages
      if (!Array.isArray(rawPages)) { markFailed('risposta non valida dal server'); return }

      // Merge AI pages with existing pages: preserve user-set fields (og_image, etc.)
      // that the AI doesn't know about and never returns.
      const existingBySlug = new Map(latestPagesRef.current.map(p => [p.slug, p]))
      newPages = (rawPages as Page[]).map(aiPage => {
        const existing = existingBySlug.get(aiPage.slug)
        if (!existing) return aiPage
        // Keep AI-generated content (html, name) but restore user metadata
        return {
          ...aiPage,
          ...(existing.og_image    ? { og_image:    existing.og_image }    : {}),
          ...(existing.menuLabel   ? { menuLabel:   existing.menuLabel }   : {}),
          ...(existing.inMenu !== undefined ? { inMenu: existing.inMenu } : {}),
        }
      })

      // Remove any static "blog" page — blog is always served dynamically from blog_posts
      newPages = newPages.filter(p => p.slug !== 'blog')

      // Preserve pages the AI didn't regenerate (e.g. legal pages, custom pages added by the user).
      // create_site regenerates the main site structure but must never silently delete pages
      // the user created manually — it only knows about pages that were in its context.
      const aiSlugs = new Set(newPages.map(p => p.slug))
      const preserved = latestPagesRef.current.filter(p => !aiSlugs.has(p.slug) && p.slug !== 'blog')
      if (preserved.length > 0) {
        newPages = [...newPages, ...preserved]
      }

      const steps = result.steps ? `\n${(result.steps as string[]).join('\n')}` : ''
      summary = `✨ ${result.input.summary ?? "fatto"}${steps}`
      // Set active to first NEW page (not existing), fallback to first page
      const newSlugs = result.input.newPageSlugs as string[] | undefined
      const firstNew = newSlugs?.find(s => newPages.some(p => p.slug === s))
      newActiveSlug = firstNew ?? (newPages.length > 0 ? newPages[0].slug : activeSlug)
      // Extract and store shared_css from home page HTML
      const homeForCss = newPages.find(p => p.slug === 'home') ?? newPages[0]
      if (homeForCss) {
        const cssBlocks = homeForCss.html.match(/<style[\s\S]*?<\/style>/gi) ?? []
        const extracted = cssBlocks.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n')
        if (extracted) sharedCssRef.current = extracted
      }

      // Auto-seed blog posts if user requested a blog and none exist yet
      const blogMentioned = /\bblog\b/i.test(effectiveInput) ||
        (rawPages as Page[]).some(p => /blog/i.test(p.slug) || /blog/i.test(p.name))
      if (blogMentioned && blogPosts.length === 0) {
        const lang = projectContext.language ?? 'it'
        const blogLabel = lang === 'es' ? 'Blog' : 'Blog'
        // Add Blog nav link to all pages if not already present
        if (!hasBlogNavLink(newPages)) newPages = addBlogLinkToNav(newPages, blogLabel)
        // Fire-and-forget: generate articles in background after state is saved
        supabase.auth.getSession().then(({ data: { session } }) => {
          const token = session?.access_token
          if (token) autoSeedBlogPosts(token)
        })
      }
    } else if (result.tool === 'edit_page') {
      const targetSlug = result.input.pageSlug as string
      const operations = (result.input.operations ?? []) as { op: 'insert_after' | 'insert_before' | 'replace'; target: string; html: string }[]
      const edits = (result.input.edits ?? []) as { find: string; replace: string }[]
      const failedOps: string[] = []
      const failedFinds: string[] = []
      newPages = pages.map(p => {
        if (p.slug !== targetSlug) return p
        let html = p.html
        // 1. Selector-based operations first (more reliable)
        for (const op of operations) {
          const [next, applied] = applySectionOp(html, op.op, op.target, op.html)
          if (applied) html = next
          else { failedOps.push(`${op.op}:${op.target}`); console.warn('[applySectionOp] FAILED target:', op.target) }
        }
        // 2. Surgical find/replace edits
        for (const edit of edits) {
          const [next, applied] = applyEdit(html, edit.find, edit.replace)
          if (applied) html = next
          else { failedFinds.push(edit.find.slice(0, 80)); console.warn('[applyEdit] FAILED find:', edit.find) }
        }
        return { ...p, html }
      })
      const totalFailed = failedOps.length + failedFinds.length
      // Fix 1: detect zero-change edits — all ops/edits failed → nothing applied to page
      const targetPageOriginal = pages.find(p => p.slug === targetSlug)
      const targetPageNew = newPages.find(p => p.slug === targetSlug)
      const htmlUnchanged = targetPageOriginal && targetPageNew && targetPageOriginal.html === targetPageNew.html
      const hadOpsOrEdits = operations.length > 0 || edits.length > 0
      if (htmlUnchanged && hadOpsOrEdits) {
        // Nothing was actually applied — surface this as a retryable failure
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, content: `⚠️ Nessuna modifica applicata — le istruzioni non hanno trovato il punto esatto nella pagina. Riprova con una descrizione più precisa, o clicca "Riprova" per un nuovo tentativo.`, failed: true, retryInput: retrySnapshot.input, retryImages: retrySnapshot.images }
          : m))
        await supabase.from('projects').update({
          site_config: await buildSiteConfig(pages, [...updatedMessages, { id: assistantId, role: 'assistant', content: '⚠️ Nessuna modifica applicata' }], mediaMeta),
          updated_at: new Date().toISOString(),
        }).eq('id', id)
        // Mark the run as html_changed: false so the back-office shows the right status
        if (result._runId && chatToken) {
          fetch(`/api/runs/${result._runId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chatToken}` },
            body: JSON.stringify({ html_changed: false }),
          }).catch(() => null)
        }
        setLoading(false)
        return
      }
      summary = `✏️ ${result.input.summary ?? "fatto"}${totalFailed ? ` ⚠️ ${totalFailed} edit parziali non applicate` : ''}`
      newActiveSlug = targetSlug

      // Fix 9: auto-sync nav and footer from home to all other pages after home is edited.
      // Prevents the "navbar/footer out-of-sync" pattern where users have to manually ask
      // "aggiorna la navbar di X copiandola dalla home".
      if (targetSlug === 'home') {
        const oldHome = pages.find(p => p.slug === 'home')
        const newHome = newPages.find(p => p.slug === 'home')
        if (oldHome && newHome) {
          const extractNav    = (h: string) => h.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? ''
          const extractFooter = (h: string) => h.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? ''
          const oldNav    = extractNav(oldHome.html)
          const newNav    = extractNav(newHome.html)
          const oldFooter = extractFooter(oldHome.html)
          const newFooter = extractFooter(newHome.html)
          const navChanged    = oldNav    !== newNav    && newNav.length > 0
          const footerChanged = oldFooter !== newFooter && newFooter.length > 0
          if (navChanged || footerChanged) {
            newPages = newPages.map(p => {
              if (p.slug === 'home') return p
              let html = p.html
              if (navChanged    && /<nav[\s\S]*?<\/nav>/i.test(html))
                html = html.replace(/<nav[\s\S]*?<\/nav>/i, newNav)
              if (footerChanged && /<footer[\s\S]*?<\/footer>/i.test(html))
                html = html.replace(/<footer[\s\S]*?<\/footer>/i, newFooter)
              return { ...p, html }
            })
            const synced = [navChanged && 'nav', footerChanged && 'footer'].filter(Boolean).join('+')
            summary += ` · ${synced} sincronizzato su tutte le pagine`
          }
        }
      }
    } else if (result.tool === 'add_page') {
      const newPage: Page = { slug: result.input.slug, name: result.input.name, html: result.input.html }
      if (newPage.slug === 'blog') {
        // Blog is dynamic — never add it as a static page; just ensure nav link exists
        newPages = hasBlogNavLink(pages) ? pages : addBlogLinkToNav(pages, 'Blog')
        summary = `📝 Blog collegato (sistema dinamico attivo)`
        newActiveSlug = activeSlug
      } else {
        // syncNavigation: adds new page link to home's nav and propagates to all pages
        newPages = syncNavigation([...pages, newPage], 'add', newPage.slug)
        // Inject home's footer into the new page (nav is handled by syncNavigation).
        // The new page is generated without nav/footer — we add them from home here
        // so the editor preview is immediately correct (serve-time injection handles prod).
        const homeForInject = newPages.find(p => p.slug === 'home')
        const sharedFooterForNewPage = homeForInject?.html.match(/<footer[\s\S]*?<\/footer>/i)?.[0]
        if (sharedFooterForNewPage) {
          newPages = newPages.map(p => {
            if (p.slug !== newPage.slug) return p
            // Fix 2: strip ALL existing footers first (agent may have generated one, injection adds another)
            // then inject home's footer exactly once before </body>
            const strippedHtml = p.html.replace(/<footer[\s\S]*?<\/footer>/gi, '')
            if (/<\/body>/i.test(strippedHtml)) {
              return { ...p, html: strippedHtml.replace(/<\/body>/i, `${sharedFooterForNewPage}\n</body>`) }
            }
            return { ...p, html: strippedHtml + `\n${sharedFooterForNewPage}` }
          })
        }
        summary = `➕ ${result.input.summary ?? "fatto"}`
        newActiveSlug = newPage.slug
      }
    } else if (result.tool === 'delete_page') {
      const targetSlug = result.input.pageSlug as string
      if (targetSlug === 'home') {
        summary = '⚠️ La pagina "home" non può essere eliminata'
      } else {
        const filtered = pages.filter(p => p.slug !== targetSlug)
        newPages = syncNavigation(filtered, 'delete', targetSlug)
        summary = `🗑 ${result.input.summary ?? "fatto"}`
        if (activeSlug === targetSlug) newActiveSlug = newPages[0]?.slug || 'home'
        // Track deleted slug so the collaborative merge doesn't restore it
        deletedSlugsRef.current.add(targetSlug)
      }
    } else if (result.tool === 'update_seo') {
      const rawSeoPages = result.input.pages
      const seoPages = Array.isArray(rawSeoPages) ? rawSeoPages as { pageSlug: string; edits: { find: string; replace: string }[] }[] : []
      let skipped = 0
      newPages = pages.map(p => {
        const seoPage = seoPages.find(sp => sp.pageSlug === p.slug)
        if (!seoPage) return p
        let html = p.html
        for (const edit of seoPage.edits) {
          const [next, applied] = applyEdit(html, edit.find, edit.replace)
          if (applied) html = next
          else skipped++
        }
        return { ...p, html }
      })
      summary = `🔍 ${result.input.summary ?? "fatto"}${skipped ? ` (${skipped} edit non applicate)` : ''}`
    } else if (result.tool === 'generate_sitemap') {
      summary = `🗺️ ${result.input.summary ?? "fatto"}`
    } else if (result.tool === 'insert_component') {
      // Render the component locally (zero tokens) and inject into one or more pages
      const inp = result.input as {
        pageSlugs?: string[]
        pageSlug?: string  // backward compat with single-page calls
        componentId: string
        data: Record<string, unknown>
        placement: 'replace-nav-link' | 'before-footer' | 'end-of-body' | 'replace-selector'
        targetText?: string
        selector?: string
      }
      const targetSlugs: string[] = Array.isArray(inp.pageSlugs) && inp.pageSlugs.length > 0
        ? inp.pageSlugs
        : inp.pageSlug ? [inp.pageSlug] : []
      const { componentId, data, placement, targetText, selector } = inp
      let componentHtml = ''
      try {
        componentHtml = renderComponentById(componentId, data)
      } catch (err) {
        summary = `⚠️ Componente "${componentId}" non disponibile: ${(err as Error).message}`
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
        const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
        await saveState(finalMessages, pages, versions)
        setLoading(false)
        return
      }
      let injected = 0
      let skipped = 0
      const skippedSlugs: string[] = []
      newPages = pages.map(p => {
        if (!targetSlugs.includes(p.slug)) return p
        let html = p.html
        let didInject = false
        if (placement === 'before-footer') {
          if (/<footer\b/i.test(html)) {
            html = html.replace(/<footer\b/i, componentHtml + '\n<footer')
            didInject = true
          }
        } else if (placement === 'end-of-body') {
          if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, componentHtml + '\n</body>')
            didInject = true
          }
        } else if (placement === 'replace-selector' && selector) {
          // Lightweight selector: only supports #id or .class targeting a single element
          const idMatch = selector.match(/^#([\w-]+)$/)
          const classMatch = selector.match(/^\.([\w-]+)$/)
          if (idMatch) {
            const re = new RegExp(`<([a-z][\\w-]*)[^>]*id=["']${idMatch[1]}["'][^>]*>[\\s\\S]*?<\\/\\1>`, 'i')
            if (re.test(html)) { html = html.replace(re, componentHtml); didInject = true }
          } else if (classMatch) {
            const re = new RegExp(`<([a-z][\\w-]*)[^>]*class=["'][^"']*\\b${classMatch[1]}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`, 'i')
            if (re.test(html)) { html = html.replace(re, componentHtml); didInject = true }
          }
        } else if (placement === 'replace-nav-link' && targetText) {
          // Find an <a>...targetText...</a> inside <nav> and replace its surrounding <li> (or the <a> if no li).
          // Also matches an existing nav-feature-dropdown <li class="comp-nfd"> with the same trigger text,
          // so the user can update/replace a previously inserted mega menu without errors.
          const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i)
          if (navMatch) {
            const navHtml = navMatch[0]
            const escaped = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            // 1. Existing mega menu (comp-nfd) with matching trigger label — replace the whole <li>
            const compNfdRe = new RegExp(
              `<li[^>]*class=["'][^"']*\\bcomp-nfd\\b[^"']*["'][\\s\\S]*?<button[^>]*class=["'][^"']*\\bcomp-nfd-trigger\\b[^"']*["'][^>]*>\\s*${escaped}[\\s\\S]*?<\\/li>`,
              'i'
            )
            // 2. Plain <li><a>label</a></li>
            const liRe = new RegExp(`<li[^>]*>\\s*<a[^>]*>\\s*${escaped}\\s*<\\/a>\\s*<\\/li>`, 'i')
            // 3. Standalone <a>label</a>
            const aRe = new RegExp(`<a[^>]*>\\s*${escaped}\\s*<\\/a>`, 'i')
            let newNav: string | null = null
            if (compNfdRe.test(navHtml)) newNav = navHtml.replace(compNfdRe, componentHtml)
            else if (liRe.test(navHtml)) newNav = navHtml.replace(liRe, componentHtml)
            else if (aRe.test(navHtml)) newNav = navHtml.replace(aRe, componentHtml)
            if (newNav) {
              html = html.replace(navHtml, newNav)
              didInject = true
            }
          }
        }
        if (didInject) injected++
        else { skipped++; skippedSlugs.push(p.slug) }
        return { ...p, html }
      })
      summary = injected > 0
        ? `🧩 ${result.input.summary ?? "fatto"} (${injected}/${targetSlugs.length} pagine)`
        : `⚠️ Componente non iniettato — target non trovato in: ${skippedSlugs.join(', ')}`
    } else if (result.tool === 'update_blog_header') {
      const newHeaderHtml = result.input.html as string
      summary = `📝 ${result.input.summary ?? "fatto"}`
      // Save blog_header_html to Supabase directly (merges into existing site_config)
      const { data: existing } = await supabase.from('projects').select('site_config').eq('id', id).single()
      const existingConfig = (existing?.site_config ?? {}) as Record<string, unknown>
      await supabase.from('projects').update({
        site_config: { ...existingConfig, blog_header_html: newHeaderHtml },
      }).eq('id', id)
      setBlogHeaderHtml(newHeaderHtml)
      // Switch to blog view so user sees the result
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
      const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
      await saveState(finalMessages, newPages, versions)
      setViewMode('blog')
      setLoading(false)
      return
    } else if (result.tool === 'set_inject_point') {
      const slot = result.input.slot as string
      const html = result.input.html as string
      summary = `🔌 ${result.input.summary ?? "fatto"}`
      // Merge into inject_points and save
      const updatedIp = { ...injectPointsRef.current }
      if (html.trim()) {
        updatedIp[slot] = html
      } else {
        delete updatedIp[slot]
      }
      setInjectPoints(updatedIp)
      injectPointsRef.current = updatedIp
      await saveInjectPoints(updatedIp)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
      const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
      await saveState(finalMessages, newPages, versions)
      setLoading(false)
      return
    }

    // Auto-inject design system into AI-updated pages
    if (designSystem && generateDesignSystemCSS(designSystem).rules.trim()) {
      newPages = applyDesignSystemToPages(designSystem, newPages)
    }
    setPages(newPages)
    setActiveSlug(newActiveSlug)
    // Auto-switch to preview so the user sees the result immediately
    if (viewMode !== 'preview') setViewMode('preview')
    // Force-refresh the edit iframe if the user was in edit mode — it has its own srcDoc
    // that doesn't auto-update when pages change. Without this the user sees stale content
    // and retries the same request thinking the change didn't apply.
    if (viewMode === 'edit') {
      const updatedActive = newPages.find(p => p.slug === newActiveSlug) ?? newPages[0]
      if (updatedActive) {
        editBaseHtmlRef.current = updatedActive.html
        setEditSrcDoc(injectBase(updatedActive.html, projectSlug, sharedNavHtmlRef.current || undefined, sharedFooterHtmlRef.current || undefined, sharedCssRef.current || undefined, faviconUrlRef.current || undefined))
        setEditOutdated(false)
      }
    }
    // Set scroll target for edits: first replaced text snippet
    if (result.tool === 'edit_page') {
      const firstEdit = (result.input.edits as { find: string; replace: string }[] | undefined)?.[0]
      if (firstEdit?.replace) setScrollTarget(firstEdit.replace.replace(/<[^>]+>/g, '').slice(0, 40).trim())
      // Fase 2a: block re-render — if this was an edit_block/replace_block normalised to edit_page,
      // push only the changed block to the preview DOM instead of full reload.
      const blockSelector = (result.input as Record<string, unknown>)?._blockSelector as string | undefined
      const blockHtml = (result.input as Record<string, unknown>)?._blockHtml as string | undefined
      if (blockSelector && blockHtml) {
        previewIframeRef.current?.contentWindow?.postMessage(
          { type: 'fact-block-update', selector: blockSelector, html: blockHtml }, '*'
        )
      }
    }
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
    const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
    void createVersion(summary.slice(0, 60).replace(/^[✨✏️➕🗑🔍🗺️🎨✍️]\s*/, ''), newPages)
    // Fase 1: persist blocks alongside html so the next request uses block-mode context.
    // Only split pages that changed (create_site = all; edit_page = just the target).
    // Run async and non-blocking — blocks are an optimisation, not critical path.
    const changedSlug = result.tool === 'edit_page' ? String(result.input?.pageSlug ?? '') : null
    newPages = newPages.map(p => {
      if (changedSlug && p.slug !== changedSlug) return p  // only split changed page on edit
      if (p.blocks && !changedSlug) return p                // keep existing blocks on untouched pages
      const blocks = splitHtmlIntoBlocks(p.html)
      return blocks ? { ...p, blocks } : p
    })
    await saveState(finalMessages, newPages)
    // Confirm html_changed: true for edit_page runs where changes were actually applied.
    // (Server set it based on ops/edits count; client is the authoritative source.)
    if (result._runId && chatToken && result.tool === 'edit_page') {
      fetch(`/api/runs/${result._runId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chatToken}` },
        body: JSON.stringify({ html_changed: true }),
      }).catch(() => null)
    }
    setLoading(false)
  }
  // Wire the ref so handleInsertComponent can call handleSend without circular deps
  handleSendRef.current = handleSend

  const handleDuplicatePage = async (slug: string) => {
    const source = pages.find(p => p.slug === slug)
    if (!source) return

    // Generate unique slug: "about" → "about-2" → "about-3" …
    const existingSlugs = new Set(pages.map(p => p.slug))
    let newSlug = `${slug}-2`
    let counter = 2
    while (existingSlugs.has(newSlug)) { counter++; newSlug = `${slug}-${counter}` }

    const newPage = {
      slug: newSlug,
      name: `${source.name} (copia)`,
      html: source.html,
    }
    const newPages = [...pages, newPage]
    setPages(newPages)
    setActiveSlug(newSlug)
    await saveState(messages, newPages)
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
    deletedSlugsRef.current.add(slug) // prevent merge from restoring it
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
    // ── SEO compiler gate — runs before publish, blocks on critical issues ──
    const seoReport = compileSeo(pages, { customDomain: customDomain ?? undefined, context: projectContext ?? undefined })
    if (seoReport.blockingIssues.length > 0) {
      const issueList = seoReport.blockingIssues
        .map(i => `• [${i.page}] ${i.message}`)
        .join('\n')
      await alertDialog({
        title: '❌ SEO — Problemi critici da risolvere',
        message: `Risolvi questi problemi prima di pubblicare:\n\n${issueList}\n\nSuggerimento: chiedi all'AI di correggerli o sistemali manualmente.`,
        variant: 'danger',
      })
      return
    }
    // Show warnings (non-blocking) if any
    if (seoReport.warnings.length > 0 && seoReport.score < 70) {
      const warnList = seoReport.warnings.slice(0, 5).map(w => `• [${w.page}] ${w.message}`).join('\n')
      const proceed = await confirmDialog({
        title: `⚠️ SEO score: ${seoReport.score}/100`,
        message: `Ci sono alcune ottimizzazioni SEO consigliate:\n\n${warnList}\n\nVuoi pubblicare comunque?`,
        confirmLabel: 'Pubblica comunque',
      })
      if (!proceed) return
    }
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

  // Persist the 301 redirects to site_config (applied at serve time — see servePublished).
  const saveRedirects = async (next: Array<{ from: string; to: string }>) => {
    setRedirectSaving(true)
    setRedirects(next)
    try {
      const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
      const currentConfig = (proj?.site_config ?? {}) as Record<string, unknown>
      await supabase.from('projects').update({
        site_config: { ...currentConfig, redirects: next },
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    } finally {
      setRedirectSaving(false)
    }
  }

  const addRedirect = async () => {
    const from = newRedirectFrom.trim()
    const to = newRedirectTo.trim()
    if (!from || !to) return
    // Normalise "from" to a leading-slash path
    const fromPath = '/' + from.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '')
    const next = [...redirects.filter(r => r.from !== fromPath), { from: fromPath, to }]
    await saveRedirects(next)
    setNewRedirectFrom('')
    setNewRedirectTo('')
  }

  const removeRedirect = async (from: string) => {
    await saveRedirects(redirects.filter(r => r.from !== from))
  }

  const handleDetectRegistrar = async (domain: string) => {
    const d = domain.trim()
    if (!d || !/\.[a-z]{2,}$/i.test(d)) return
    setDetectingRegistrar(true)
    setRegistrarInfo(null)
    try {
      const res = await fetch(`/api/detect-registrar?domain=${encodeURIComponent(d)}`)
      if (res.ok) setRegistrarInfo(await res.json())
    } catch { /* ignore */ }
    finally { setDetectingRegistrar(false) }
  }

  const handleConfigureCloudflare = async () => {
    if (!cfApiToken.trim() || !cfZoneId.trim()) return
    setCfConfiguring(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/configure-cloudflare-dns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id, domain: customDomain.trim(), cfApiToken: cfApiToken.trim(), cfZoneId: cfZoneId.trim() }),
      })
      const result = await res.json()
      if (!res.ok) { await alertDialog({ title: 'Errore Cloudflare', message: String(result.error), variant: 'danger' }); return }
      // DNS configured — add domain to Vercel and start verification
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent
      await handleAddCustomDomain(fakeEvent)
    } catch (err) { await alertDialog({ title: 'Errore', message: String(err), variant: 'danger' }) }
    finally { setCfConfiguring(false) }
  }

  const handleRemoveDomain = async () => {
    const confirmed = await confirmDialog({ title: 'Rimuovi dominio', message: `Vuoi rimuovere ${customDomain} da questo progetto? Il sito tornerà sul dominio di staging.`, confirmLabel: 'Rimuovi', variant: 'danger' })
    if (!confirmed) return
    setRemovingDomain(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await fetch('/api/remove-custom-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId: id }),
      })
      setCustomDomain('')
      setCustomDomainStatus(null)
      setDnsInstructions('')
      setRegistrarInfo(null)
      if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current)
    } catch (err) { await alertDialog({ title: 'Errore', message: String(err), variant: 'danger' }) }
    finally { setRemovingDomain(false) }
  }

  useEffect(() => {
    if (customDomainStatus === 'pending') startPolling()
    return () => { if (verifyIntervalRef.current) clearInterval(verifyIntervalRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDomainStatus === 'pending'])

  // Build semantic <figure> HTML from a URL + optional metadata
  const buildImageHtml = (url: string, meta?: MediaMeta) => {
    const alt     = meta?.alt     ? ` alt="${meta.alt.replace(/"/g, '&quot;')}"` : ' alt=""'
    const title   = meta?.title   ? ` title="${meta.title.replace(/"/g, '&quot;')}"` : ''
    const caption = meta?.caption ? `<figcaption style="font-size:0.85rem;color:#666;margin-top:6px;text-align:center">${meta.caption}</figcaption>` : ''
    return `<figure style="margin:1.5rem 0;text-align:center;"><img src="${url}"${alt}${title} style="max-width:100%;height:auto;border-radius:8px;display:inline-block;">${caption}</figure>`
  }

  // Insert image into the correct editor iframe — always carrying metadata
  const insertMediaImageUrl = (url: string, meta?: MediaMeta) => {
    const imgHtml = buildImageHtml(url, meta)
    if (mediaPickerTarget === 'blog') {
      blogIframeRef.current?.contentWindow?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: imgHtml }, '*')
    } else if (mediaPickerTarget === 'inline') {
      editIframeRef.current?.contentWindow?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: imgHtml }, '*')
    }
    setMediaPickerTarget(null)
  }

  // Upload a new file and insert it
  const handleMediaPickerUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const ext = file.name.split('.').pop() || 'png'
    const path = `${session.user.id}/${id}/media-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
    if (error) return
    const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
    await loadMedia()
    insertMediaImageUrl(publicUrl)
    // Auto-generate SEO metadata (alt, title, caption, description) for newly uploaded image
    generateAndSaveImageMeta(path, publicUrl)
  }

  return (
    <main style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: C.bg }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {creditsBalance !== null && (
              <button
                onClick={() => setShowPaywall(true)}
                title="Crediti residui — clicca per ricaricare"
                style={{
                  background: creditsBalance < 5000 ? '#fee2e2' : '#f1f5f9',
                  border: `1px solid ${creditsBalance < 5000 ? '#fecaca' : C.border}`,
                  color: creditsBalance < 5000 ? '#b91c1c' : C.text,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '3px 9px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  lineHeight: 1.3,
                }}
              >
                ⚡ {creditsBalance.toLocaleString('it-IT')}
              </button>
            )}
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

        {/* Save error banner — shown when saveState fails after all retries */}
        {saveError && (
          <div style={{
            background: '#fef2f2', borderBottom: '1px solid #fecaca',
            padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '8px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.8rem', color: '#b91c1c', fontWeight: 500 }}>{saveError}</span>
            <button onClick={() => setSaveError(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c',
              fontSize: '1rem', lineHeight: 1, padding: '0 4px',
            }}>×</button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={chatListRef}
          style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
              <p style={{ fontSize: '0.9375rem', color: '#57534e', marginBottom: '0.4rem', fontWeight: 500 }}>{t('project.describeWebsite' as const, language as any)}</p>
              <p style={{ fontSize: '0.8125rem', color: C.textFaint }}>Es: &quot;{t('project.exampleWebsite' as const, language as any)}&quot;</p>
            </div>
          )}

          {/* Sentinel observed by IntersectionObserver — load older messages when visible */}
          <div ref={topSentinelRef} style={{ height: '1px', flexShrink: 0 }} />

          {messages.slice(-visibleMsgCount).map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                {/* Timestamp — from explicit field (new msgs) or parsed from id (legacy) */}
                {(() => {
                  const ts = msg.timestamp ? new Date(msg.timestamp) : (msg.id.startsWith('u_') ? new Date(parseInt(msg.id.slice(2))) : null)
                  if (!ts || isNaN(ts.getTime())) return null
                  const now = new Date()
                  const isToday = ts.toDateString() === now.toDateString()
                  const label = isToday
                    ? ts.toLocaleTimeString(language === 'it' ? 'it-IT' : language === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
                    : ts.toLocaleDateString(language === 'it' ? 'it-IT' : language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' }) + ', ' + ts.toLocaleTimeString(language === 'it' ? 'it-IT' : language === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
                  return <span style={{ fontSize: '0.68rem', color: C.textFaint, paddingRight: '2px' }}>{label}</span>
                })()}
                <div style={{
                  maxWidth: '82%', padding: '10px 14px',
                  background: C.userBubble, color: C.text,
                  borderRadius: '14px', fontSize: '0.9rem', lineHeight: '1.55',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {/* Text content — never show raw image URLs */}
                  {(() => {
                    // Legacy messages may still have "Immagine allegata: url" in content — strip them for display
                    const displayText = msg.content
                      .replace(/\n*Immagine allegata: https?:\/\/[^\n]*/g, '')
                      .trim()
                    return displayText || null
                  })()}
                  {/* Image thumbnails — from new msg.images or legacy content */}
                  {(() => {
                    const imgs = msg.images?.length
                      ? msg.images
                      : [...msg.content.matchAll(/Immagine allegata: (https?:\/\/[^\n]+)/g)].map(m => m[1])
                    if (!imgs.length) return null
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: msg.content.replace(/\n*Immagine allegata: https?:\/\/[^\n]*/g, '').trim() ? '8px' : '0' }}>
                        {imgs.map((url, i) => (
                          <img key={i} src={url} alt="allegato" style={{
                            maxWidth: '160px', maxHeight: '120px', borderRadius: '8px',
                            objectFit: 'cover', border: `1px solid ${C.border}`,
                          }} />
                        ))}
                      </div>
                    )
                  })()}
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
                    {(() => {
                      const isRunning = msg.id === loadingMsgId && loading && !msg.content
                      if (!isRunning) {
                        // Show typing animation for new messages, full content for old ones
                        const displayed = msg.id in typingContent ? typingContent[msg.id] : msg.content
                        return stripHtmlFromChat(displayed, language) || ''
                      }
                      // ── Progress block (Claude Code style) ──
                      const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
                      const spin = SPINNER[elapsedSeconds % SPINNER.length]
                      const steps = msg.progressSteps ?? []
                      const isPipeline = steps.length > 0
                      const nextLabel =
                        steps.length === 0 ? 'Analizzando…' :
                        steps.length === 1 ? 'Generando contenuti e design…' :
                        steps.length === 2 ? 'Costruendo HTML…' :
                        'Finalizzando…'
                      return (
                        <div style={{
                          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                          fontSize: '0.8rem',
                          background: '#f7f6f3',
                          border: `1px solid ${C.border}`,
                          borderRadius: '10px',
                          padding: isPipeline ? '12px 14px' : '10px 14px',
                          display: 'inline-flex',
                          flexDirection: 'column',
                          gap: '5px',
                          minWidth: '230px',
                        }}>
                          {/* Completed pipeline steps */}
                          {steps.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: '#22c55e', fontSize: '0.72rem', width: '12px' }}>✓</span>
                              <span style={{ flex: 1, color: C.textMuted }}>{s.step}</span>
                              <span style={{ color: C.textFaint, fontSize: '0.7rem' }}>{s.time}</span>
                            </div>
                          ))}
                          {/* Current spinner row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: C.blue, fontSize: '0.8rem', width: '12px', display: 'inline-block', textAlign: 'center' }}>{spin}</span>
                            <span style={{ flex: 1, color: C.text, fontWeight: 500 }}>
                              {isPipeline ? nextLabel : 'Lavorando…'}
                            </span>
                            <span style={{ color: C.textFaint, fontSize: '0.7rem' }}>{elapsedSeconds}s</span>
                          </div>
                        </div>
                      )
                    })()}
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
          {/* Context badge: shows selected block or visible blocks */}
          {(previewSelection && Date.now() - previewSelection.timestamp < 120_000) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '6px', fontSize: '0.72rem', color: '#1d4ed8' }}>
              <span>🎯</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{previewSelection.blockSelector}</strong>
                {previewSelection.anchorText ? ` — "${previewSelection.anchorText.slice(0, 50)}"` : ''}
              </span>
              {/* Fase 2b: rigenera sezione con un click */}
              <button
                onClick={() => {
                  const msg = `Rigenera completamente la sezione ${previewSelection.blockSelector} — ridisegnala in modo creativo mantenendo lo stesso contenuto e stile del sito`
                  const fakeEvent = { preventDefault: () => {} } as React.FormEvent
                  handleSendRef.current?.(fakeEvent, { input: msg, images: [] })
                  setPreviewSelection(null)
                }}
                title="Rigenera questa sezione con l'AI"
                style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: '5px', padding: '2px 8px', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
              >🔄 Rigenera</button>
              <button onClick={() => setPreviewSelection(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', fontSize: '0.9rem', padding: '0 2px' }}>✕</button>
            </div>
          ) : visibleBlocks.length > 0 && pages.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '6px', fontSize: '0.68rem', color: '#64748b' }}>
              <span>👁</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Visibili: {visibleBlocks.slice(0, 3).join(', ')}
              </span>
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
                onFocus={() => {
                  // Ask the preview iframe which blocks are currently in viewport.
                  // Response arrives as fact-visible-blocks and updates visibleBlocks state.
                  previewIframeRef.current?.contentWindow?.postMessage({ type: 'fact-get-visible' }, '*')
                }}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  const maxH = 180
                  const newH = Math.min(e.target.scrollHeight, maxH)
                  e.target.style.height = `${newH}px`
                  e.target.style.overflowY = e.target.scrollHeight > maxH ? 'auto' : 'hidden'
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
                  <button
                    type="button"
                    onClick={() => setShowComponentCanvas(true)}
                    disabled={loading}
                    title="Crea un blocco isolato e inseriscilo nel sito"
                    style={{
                      background: 'transparent', color: C.textFaint, border: `1px solid ${C.border}`,
                      padding: '4px 9px', fontSize: '0.78rem', borderRadius: '6px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    ⊞ Blocco
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
              label={<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"><rect x="0.5" y="1.5" width="13" height="11" rx="1.5"/><circle cx="4.5" cy="5.5" r="1.2"/><polyline points="0.5,12.5 4.5,8 7.5,10.5 9.5,8 13.5,12.5"/></svg>}
              title={t('project.mediaLibrary' as const, language as any)}
              active={viewMode === 'media'}
              onClick={() => setViewMode('media')}
            />
            <ToolbarBtn
              label={(() => {
                const score = getAggregateScore(seoAnalyses)
                const color = pages.length > 0 ? scoreColor(score) : C.textFaint
                return <span style={{ color, fontWeight: 700, fontSize: '0.72rem' }}>
                  SEO {pages.length > 0 ? score : '—'}
                </span>
              })()}
              title="SEO Optimizer"
              active={viewMode === 'seo'}
              onClick={() => setViewMode('seo')}
            />
            <ToolbarBtn
              label={<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"><rect x="2" y="2" width="10" height="12" rx="1.5"/><line x1="4.5" y1="5.5" x2="9.5" y2="5.5"/><line x1="4.5" y1="8" x2="9.5" y2="8"/><line x1="4.5" y1="10.5" x2="7.5" y2="10.5"/></svg>}
              title="Gestione pagine"
              active={viewMode === 'pages'}
              onClick={() => setViewMode('pages')}
            />
            <ToolbarBtn
              label={<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"><path d="M8 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H10a1.5 1.5 0 0 0 1.5-1.5V5.5"/><line x1="4.5" y1="7" x2="8" y2="7"/><line x1="4.5" y1="9.5" x2="7" y2="9.5"/><path d="M9 1l2.5 2.5-3.5 3.5H5.5V4.5L9 1Z"/></svg>}
              title="Blog"
              active={viewMode === 'blog'}
              onClick={() => setViewMode('blog')}
            />
            <ToolbarBtn
              label={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>}
              title="Design System"
              active={viewMode === 'design'}
              onClick={() => setViewMode('design')}
            />
            <ToolbarBtn
              label="🔌"
              title="Componenti"
              active={viewMode === 'integrations'}
              onClick={() => setViewMode('integrations')}
            />
          </div>

          {/* URL bar — single scrollable input + dropdown for page navigation */}
          <div style={{ flex: 1, maxWidth: '420px', position: 'relative' }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: C.white, border: `1px solid ${showUrlDropdown ? C.blue : C.border}`,
              borderRadius: showUrlDropdown ? '7px 7px 0 0' : '7px', padding: '0 6px 0 8px',
              overflow: 'hidden', transition: 'border-color 0.15s',
            }}>
              <span style={{ fontSize: '0.75rem', color: C.textFaint, flexShrink: 0, marginRight: '6px', lineHeight: 1 }}>□</span>
              <input
                readOnly
                value={publicUrl ? publicUrl.replace(/^https?:\/\//, '') : '—'}
                onClick={() => publicBaseUrl && setShowUrlDropdown(v => !v)}
                title="Clicca per navigare tra le pagine"
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: '0.75rem', fontFamily: 'monospace', color: publicBaseUrl ? C.text : C.textFaint,
                  fontWeight: 400, flex: 1, minWidth: 0, cursor: publicBaseUrl ? 'pointer' : 'default',
                  padding: '5px 0', overflow: 'hidden',
                }}
              />
              {publicUrl && (
                <button onClick={copyUrl} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: copied ? '#10b981' : C.textFaint, fontSize: '0.75rem', flexShrink: 0, marginLeft: '2px' }} title={t('project.copyUrl' as const, language as any)}>
                  {copied ? '✓' : '⧉'}
                </button>
              )}
            </div>
            {/* Dropdown */}
            {showUrlDropdown && publicBaseUrl && (
              <>
                {/* Backdrop */}
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowUrlDropdown(false)} />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: C.white, border: `1px solid ${C.blue}`, borderTop: `1px solid ${C.border}`,
                  borderRadius: '0 0 7px 7px', boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                  maxHeight: '260px', overflowY: 'auto',
                }}>
                  {/* ── Pages ── */}
                  {pages.map(p => {
                    const urlPath = p.slug === 'home' ? '' : p.slug
                    // A page is active only when no blog post is selected
                    const isActive = !activeCodeBlogPostId
                      && viewMode !== 'blog'
                      && activeSlug === p.slug
                      && !(viewMode === 'preview' && previewIframePath && previewIframePath !== '/')
                    return (
                      <button key={p.slug} onClick={() => {
                        setShowUrlDropdown(false)
                        setActiveSlug(p.slug)
                        if (viewMode === 'code') {
                          // code editor: load page HTML, deselect any blog post
                          setActiveCodeBlogPostId(null)
                          setCodeContent(pages.find(pg => pg.slug === p.slug)?.html ?? '')
                          setCodeSaving('idle')
                        } else if (viewMode === 'blog') {
                          setViewMode('preview')
                        } else if (viewMode === 'preview') {
                          setPreviewIframePath(null)
                        }
                      }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '7px 12px', border: 'none',
                          background: isActive ? '#f0f4ff' : 'transparent',
                          fontSize: '0.75rem', fontFamily: 'monospace',
                          color: isActive ? C.blue : C.text,
                          cursor: 'pointer', fontWeight: isActive ? 600 : 400,
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f4' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                      >
                        /{urlPath}
                      </button>
                    )
                  })}

                  {/* ── Blog articles ── */}
                  {blogPosts.length > 0 && (
                    <>
                      <div style={{ height: '1px', background: C.border, margin: '2px 0' }} />
                      {blogPosts.map(post => {
                        const postPath = post.categories?.[0]
                          ? `blog/${slugify(post.categories[0])}/${post.slug}`
                          : `blog/${post.slug}`
                        const isActive =
                          (viewMode === 'blog' && selectedPost?.id === post.id) ||
                          (viewMode === 'code' && activeCodeBlogPostId === post.id) ||
                          (viewMode === 'preview' && previewIframePath === '/' + postPath)
                        return (
                          <button key={post.id} onClick={async () => {
                            setShowUrlDropdown(false)
                            if (viewMode === 'code') {
                              // HTML editor: load article HTML
                              setActiveCodeBlogPostId(post.id)
                              setActiveCodeBlogPostTitle(post.title)
                              setCodeSaving('idle')
                              const { data: { session } } = await supabase.auth.getSession()
                              const token = session?.access_token
                              if (!token) return
                              const res = await fetch(`/api/blog-posts/${post.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
                              const json = await res.json()
                              setCodeContent(prettifyHtml(json.post?.content_html ?? ''))
                            } else if (viewMode === 'preview') {
                              // Preview: navigate iframe to article
                              setPreviewIframePath('/' + postPath)
                            } else {
                              // All other modes: open blog editor on this article
                              setViewMode('blog')
                              setSelectedPost(post)
                            }
                          }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: '7px 12px', border: 'none',
                              background: isActive ? '#f0f4ff' : 'transparent',
                              fontSize: '0.75rem', fontFamily: 'monospace',
                              color: isActive ? C.blue : C.text,
                              cursor: 'pointer', fontWeight: isActive ? 600 : 400,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f4' }}
                            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                          >
                            /{postPath}
                          </button>
                        )
                      })}
                    </>
                  )}
                </div>
              </>
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
                disabled={publishing}
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
                            // Version pages are stored lazily in project_versions —
                            // fetch the full snapshot for this version before restoring.
                            let restorePages = v.pages
                            if (!restorePages) {
                              const { data, error } = await supabase
                                .from('project_versions')
                                .select('pages')
                                .eq('id', v.id)
                                .single()
                              if (error || !data?.pages) {
                                await alertDialog({ title: 'Errore', message: 'Impossibile caricare questa versione.', variant: 'danger' })
                                return
                              }
                              restorePages = data.pages as Page[]
                            }
                            if (!restorePages || restorePages.length === 0) return
                            // Snapshot current state as a backup version first
                            void createVersion('Backup prima del ripristino', pages)
                            setPages(restorePages)
                            setActiveSlug(restorePages[0]?.slug || 'home')
                            await saveState(messages, restorePages)
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
        ) : viewMode === 'seo' ? (
          /* ── SEO Optimizer Panel ─────────────────────────────────────────── */
          (() => {
            // Determine which analyses to show
            const displayAnalyses = seoPageSlug === 'all' ? seoAnalyses : seoAnalyses.filter(a => a.pageSlug === seoPageSlug)
            const aggregateScore = displayAnalyses.length > 0
              ? Math.round(displayAnalyses.reduce((s, a) => s + a.overallScore, 0) / displayAnalyses.length)
              : 0
            const aggColor = scoreColor(aggregateScore)

            // For per-check display, merge results across pages (use first page or selected)
            const primaryAnalysis = seoPageSlug === 'all'
              ? (seoAnalyses[0] ?? null)
              : (seoAnalyses.find(a => a.pageSlug === seoPageSlug) ?? null)

            // Gather all results for the selected scope
            const mergedResults: Record<CheckId, CheckResult[]> = {} as Record<CheckId, CheckResult[]>
            for (const a of displayAnalyses) {
              for (const r of a.results) {
                if (!mergedResults[r.checkId]) mergedResults[r.checkId] = []
                mergedResults[r.checkId].push(r)
              }
            }
            // Average score across pages for each check
            const avgResult = (checkId: CheckId): CheckResult | null => {
              const arr = mergedResults[checkId]
              if (!arr || arr.length === 0) return null
              const avgScore = Math.round(arr.reduce((s, r) => s + r.score, 0) / arr.length)
              const worst = arr.find(r => r.status === 'fail') ?? arr.find(r => r.status === 'warn') ?? arr[0]
              return { ...worst, score: avgScore, status: avgScore >= 80 ? 'pass' : avgScore >= 40 ? 'warn' : 'fail' }
            }

            const statusIcon = (s: 'pass' | 'warn' | 'fail') =>
              s === 'pass' ? '✅' : s === 'warn' ? '⚠️' : '❌'
            const statusColor = (s: 'pass' | 'warn' | 'fail') =>
              s === 'pass' ? '#10b981' : s === 'warn' ? '#f59e0b' : '#ef4444'

            // fixScope: regular page slugs only ("all" → every regular page).
            // Blog posts are auto-rendered HTML — their SEO is fixed by editing
            // the post directly (seo_title / seo_description fields) in the Blog tab.
            const isBlogPostSelected = seoPageSlug.startsWith('blog/')
            const fixScope: string | string[] = seoPageSlug === 'all'
              ? pages.map(p => p.slug)
              : seoPageSlug

            return (
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: C.bg }}>
                {/* ── Left sidebar: score gauge + page selector ── */}
                <div style={{
                  width: '220px', flexShrink: 0, borderRight: `1px solid ${C.border}`,
                  display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: '20px',
                  overflowY: 'auto',
                }}>
                  {/* Overall score */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: '88px', height: '88px', borderRadius: '50%', margin: '0 auto 10px',
                      background: `conic-gradient(${aggColor} ${aggregateScore * 3.6}deg, ${C.border} 0deg)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 0 6px ${C.bg}`,
                      position: 'relative',
                    }}>
                      <div style={{
                        width: '64px', height: '64px', borderRadius: '50%', background: C.bg,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: '1.4rem', fontWeight: 700, color: aggColor, lineHeight: 1 }}>{aggregateScore}</span>
                        <span style={{ fontSize: '0.6rem', color: C.textFaint, marginTop: '1px' }}>/100</span>
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: C.text }}>SEO Score</p>
                    <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: C.textFaint }}>
                      {aggregateScore >= 80 ? 'Ottimo!' : aggregateScore >= 60 ? 'Buono' : aggregateScore >= 40 ? 'Da migliorare' : 'Critico'}
                    </p>
                  </div>

                  {/* Page selector */}
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pagina</p>
                    <select
                      value={seoPageSlug}
                      onChange={e => setSeoPageSlug(e.target.value)}
                      style={{
                        width: '100%', padding: '6px 8px', borderRadius: '7px',
                        border: `1px solid ${C.border}`, background: C.white,
                        fontSize: '0.78rem', color: C.text, fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    >
                      <option value="all">Tutte le pagine</option>
                      {pages.map(p => {
                        const a = seoAnalyses.find(x => x.pageSlug === p.slug)
                        return (
                          <option key={p.slug} value={p.slug}>
                            {p.name} {a ? `(${a.overallScore})` : ''}
                          </option>
                        )
                      })}
                      {seoAnalyses.filter(a => a.pageSlug.startsWith('blog/')).length > 0 && (
                        <optgroup label="📝 Blog">
                          {seoAnalyses.filter(a => a.pageSlug.startsWith('blog/')).map(a => (
                            <option key={a.pageSlug} value={a.pageSlug}>
                              {a.pageName.replace(/^📝 /, '')} ({a.overallScore})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {/* Score breakdown by group */}
                  <div>
                    <p style={{ margin: '0 0 8px', fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gruppi</p>
                    {SEO_GROUPS.map(g => {
                      const groupChecks = SEO_CHECKS.filter(c => c.group === g.id)
                      const groupResults = groupChecks.map(c => avgResult(c.id)).filter(Boolean) as CheckResult[]
                      const groupScore = groupResults.length > 0
                        ? Math.round(groupResults.reduce((s, r) => s + r.score, 0) / groupResults.length)
                        : 0
                      const gColor = scoreColor(groupScore)
                      return (
                        <div key={g.id} style={{ marginBottom: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <span style={{ fontSize: '0.7rem', color: C.textMuted }}>{g.label}</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: gColor }}>{groupScore}</span>
                          </div>
                          <div style={{ height: '4px', borderRadius: '2px', background: C.border, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${groupScore}%`, background: gColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Fix All button (only for regular pages; blog posts are fixed inline) */}
                  {primaryAnalysis && !isBlogPostSelected && (
                    <button
                      onClick={() => fixAllFailing(fixScope)}
                      disabled={!!seoFixing || !primaryAnalysis.results.some(r => r.status !== 'pass')}
                      style={{
                        padding: '8px 12px', borderRadius: '8px', border: 'none',
                        background: seoFixing ? C.bgPanel : C.dark, color: 'white',
                        fontSize: '0.78rem', fontWeight: 600, cursor: seoFixing ? 'wait' : 'pointer',
                        fontFamily: 'inherit', transition: 'opacity 0.15s',
                        opacity: seoFixing ? 0.6 : 1,
                      }}
                    >
                      {seoFixing ? '⏳ Fix in corso…' : '⚡ Fix All Failing'}
                    </button>
                  )}
                  {isBlogPostSelected && (
                    <div style={{
                      padding: '10px 12px', borderRadius: '8px',
                      background: C.bgPanel, border: `1px dashed ${C.border}`,
                      fontSize: '0.72rem', color: C.textMuted, lineHeight: 1.5,
                    }}>
                      💡 Per correggere un articolo, modifica i campi SEO direttamente nel tab <strong>Blog</strong>.
                    </div>
                  )}
                </div>

                {/* ── Main area: tabbed ── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                  <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                    {/* Header */}
                    <div style={{ marginBottom: '12px' }}>
                      <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 700, color: C.text }}>SEO Optimizer</h2>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: C.textFaint }}>
                        Analisi live • {SEO_CHECKS.length} check • aggiornata automaticamente
                      </p>
                    </div>

                    {/* Sub-tab bar */}
                    <div style={{ display: 'flex', gap: '2px', marginBottom: '16px', borderBottom: `1px solid ${C.border}` }}>
                      {([
                        { id: 'checks', label: '📋 Analisi SEO' },
                        { id: 'tools', label: '🔧 Strumenti' },
                        { id: 'sitemap', label: '🗺️ Sitemap' },
                        { id: 'keywords', label: '🎯 Keyword' },
                      ] as const).map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setSeoSubTab(tab.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            padding: '8px 14px', fontSize: '0.82rem', fontWeight: seoSubTab === tab.id ? 700 : 500,
                            color: seoSubTab === tab.id ? C.blue : C.textMuted,
                            borderBottom: seoSubTab === tab.id ? `2px solid ${C.blue}` : '2px solid transparent',
                            marginBottom: '-1px', transition: 'all 0.15s',
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Error banner (shown on all tabs) */}
                    {seoFixError && (
                      <div style={{
                        marginBottom: '16px', padding: '10px 14px', borderRadius: '8px',
                        background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c',
                        fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px',
                      }}>
                        <span>❌</span>
                        <span style={{ flex: 1 }}>{seoFixError}</span>
                        <button onClick={() => setSeoFixError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: '1rem', padding: 0 }}>✕</button>
                      </div>
                    )}

                    {/* ── Tab: checks ── */}
                    {seoSubTab === 'checks' && SEO_GROUPS.map(group => {
                      const groupChecks = SEO_CHECKS.filter(c => c.group === group.id)
                      const groupResults = groupChecks.map(c => avgResult(c.id)).filter(Boolean) as CheckResult[]
                      const passing = groupResults.filter(r => r.status === 'pass').length
                      return (
                        <div key={group.id} style={{ marginBottom: '24px' }}>
                          {/* Group header */}
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 0', borderBottom: `1px solid ${C.border}`, marginBottom: '2px',
                          }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>{group.label}</span>
                            <span style={{ fontSize: '0.72rem', color: C.textFaint }}>
                              {passing}/{groupChecks.length} pass
                            </span>
                          </div>

                          {/* Checks in group */}
                          {groupChecks.map(check => {
                            const result = avgResult(check.id)
                            if (!result) return null
                            const isFixing = seoFixing === check.id
                            // Blog posts: only title-tag, meta-description, open-graph are auto-fixable
                            const canFix = result.score < 100 &&
                              check.fixable !== false &&
                              (!isBlogPostSelected || BLOG_FIXABLE_CHECKS.includes(check.id))
                            return (
                              <div
                                key={check.id}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: '12px',
                                  padding: '10px 12px', borderRadius: '8px',
                                  background: isFixing ? '#fffbeb' : 'transparent',
                                  transition: 'background 0.2s',
                                  borderBottom: `1px solid ${C.borderLight}`,
                                }}
                              >
                                {/* Status icon */}
                                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{statusIcon(result.status)}</span>

                                {/* Label + detail */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.text }}>{check.label}</span>
                                    <span style={{
                                      fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px',
                                      borderRadius: '4px', background: statusColor(result.status) + '18',
                                      color: statusColor(result.status),
                                    }}>
                                      {result.score}/100
                                    </span>
                                    {check.fixOwner === 'seo' && (
                                      <span style={{ fontSize: '0.62rem', color: C.textFaint, background: C.bgPanel, padding: '1px 5px', borderRadius: '4px' }}>AI</span>
                                    )}
                                  </div>
                                  <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: C.textFaint, lineHeight: 1.4 }}>
                                    {result.detail || check.description}
                                  </p>
                                  {/* Score bar */}
                                  <div style={{ marginTop: '5px', height: '3px', borderRadius: '2px', background: C.border, overflow: 'hidden', maxWidth: '240px' }}>
                                    <div style={{
                                      height: '100%', width: `${result.score}%`,
                                      background: statusColor(result.status),
                                      borderRadius: '2px', transition: 'width 0.4s ease',
                                    }} />
                                  </div>
                                </div>

                                {/* Fix button */}
                                {canFix && (
                                  <button
                                    onClick={() => fixCheck(check.id, fixScope)}
                                    disabled={!!seoFixing}
                                    title={`Correggi: ${check.label}`}
                                    style={{
                                      flexShrink: 0, padding: '5px 12px', borderRadius: '6px',
                                      border: `1px solid ${C.border}`,
                                      background: isFixing ? '#f59e0b' : C.white,
                                      color: isFixing ? 'white' : C.text,
                                      fontSize: '0.72rem', fontWeight: 600,
                                      cursor: seoFixing ? 'wait' : 'pointer',
                                      fontFamily: 'inherit', transition: 'all 0.15s',
                                      opacity: seoFixing && !isFixing ? 0.5 : 1,
                                    }}
                                  >
                                    {isFixing ? '⏳' : '⚡ Fix'}
                                  </button>
                                )}
                                {!canFix && (
                                  <span style={{ flexShrink: 0, fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>✓ OK</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}

                    {/* ── Tab: tools ── */}
                    {seoSubTab === 'tools' && (
                      <div>

                    {/* ── Link Checker Panel ── */}
                    <div style={{ marginBottom: '24px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 0', borderBottom: `1px solid ${C.border}`, marginBottom: '12px',
                      }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>Controllo link rotti</span>
                        {linkCheckTime && (
                          <span style={{ fontSize: '0.72rem', color: C.textFaint }}>
                            Ultimo controllo: {linkCheckTime}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={async () => {
                          if (linkCheckRunning) return
                          setLinkCheckRunning(true)
                          setLinkCheckResults(null)
                          setLinkCheckTotals(null)
                          try {
                            const { data: { session: lkSession } } = await supabase.auth.getSession()
                            const lkToken = lkSession?.access_token
                            if (!lkToken) return
                            const resp = await fetch(`/api/check-broken-links?projectId=${id}`, {
                              headers: { Authorization: `Bearer ${lkToken}` },
                            })
                            if (!resp.ok) throw new Error(await resp.text())
                            const json = await resp.json() as { results: typeof linkCheckResults; totalChecked: number; totalBroken: number }
                            setLinkCheckResults(json.results)
                            setLinkCheckTotals({ checked: json.totalChecked, broken: json.totalBroken })
                            setLinkCheckTime(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))
                          } catch (err) {
                            console.error('[LinkChecker]', err)
                          } finally {
                            setLinkCheckRunning(false)
                          }
                        }}
                        disabled={linkCheckRunning}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '7px 14px', borderRadius: '7px',
                          border: `1px solid ${C.border}`,
                          background: linkCheckRunning ? C.bgPanel : C.white,
                          color: linkCheckRunning ? C.textFaint : C.text,
                          fontSize: '0.8rem', fontWeight: 600,
                          cursor: linkCheckRunning ? 'wait' : 'pointer',
                          fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        {linkCheckRunning ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                            </svg>
                            Controllo in corso...
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                            Controlla link rotti
                          </>
                        )}
                      </button>

                      {linkCheckResults !== null && linkCheckTotals !== null && (
                        <div style={{ marginTop: '12px' }}>
                          {linkCheckTotals.broken === 0 ? (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '10px 14px', borderRadius: '8px',
                              background: '#f0fdf4', border: '1px solid #86efac',
                              color: '#15803d', fontSize: '0.82rem', fontWeight: 600,
                            }}>
                              <span>✓</span>
                              <span>Nessun link rotto trovato — {linkCheckTotals.checked} link controllati</span>
                            </div>
                          ) : (
                            <div>
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '10px 14px', borderRadius: '8px',
                                background: '#fef2f2', border: '1px solid #fca5a5',
                                color: '#b91c1c', fontSize: '0.82rem', fontWeight: 600,
                                marginBottom: '12px',
                              }}>
                                <span>⚠</span>
                                <span>{linkCheckTotals.broken} link rotti su {linkCheckTotals.checked} controllati</span>
                              </div>

                              {linkCheckResults.map(pageResult => (
                                <div key={pageResult.pageSlug} style={{ marginBottom: '16px' }}>
                                  <div style={{
                                    fontSize: '0.78rem', fontWeight: 700, color: C.text,
                                    marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px',
                                  }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                      <polyline points="9 22 9 12 15 12 15 22"/>
                                    </svg>
                                    {pageResult.pageName}
                                    <span style={{ fontWeight: 400, color: C.textFaint }}>({pageResult.pageSlug})</span>
                                  </div>
                                  {pageResult.brokenLinks.map(link => (
                                    <div
                                      key={link.url}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '7px 10px', borderRadius: '6px',
                                        background: C.bgPanel, marginBottom: '4px',
                                        border: `1px solid ${C.borderLight}`,
                                      }}
                                    >
                                      <span style={{
                                        flexShrink: 0, fontSize: '0.68rem', fontWeight: 700,
                                        padding: '2px 7px', borderRadius: '4px',
                                        background: typeof link.status === 'number' && link.status >= 500 ? '#7f1d1d' : '#b91c1c',
                                        color: 'white',
                                        minWidth: '38px', textAlign: 'center',
                                      }}>
                                        {link.status}
                                      </span>
                                      <span style={{
                                        flex: 1, fontSize: '0.75rem', color: C.textMuted,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        fontFamily: 'monospace',
                                      }} title={link.url}>
                                        {link.url}
                                      </span>
                                      <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ flexShrink: 0, color: C.blue, fontSize: '0.7rem', textDecoration: 'none' }}
                                      >
                                        ↗
                                      </a>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Google Tag Manager card ──────────────────────────── */}
                    {(() => {
                      const isActive = !!(injectPoints.head?.includes('GTM-') || injectPoints.body_end?.includes('GTM-'))

                      const saveGtm = async () => {
                        const id = gtmId.trim().toUpperCase()
                        if (!id || !id.match(/^GTM-[A-Z0-9]+$/)) return
                        setGtmSaving('saving')
                        const headSnippet = `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>\n<!-- End Google Tag Manager -->`
                        const bodySnippet = `<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n<!-- End Google Tag Manager (noscript) -->`
                        // Prepend to existing head/body_end content (non-GTM parts preserved)
                        const stripOldGtm = (s: string) => s.replace(/<!-- Google Tag Manager[\s\S]*?<!-- End Google Tag Manager[^\n]*-->\n?/g, '').trim()
                        const newHead = headSnippet + (stripOldGtm(injectPoints.head ?? '') ? '\n' + stripOldGtm(injectPoints.head ?? '') : '')
                        const newBodyEnd = bodySnippet + (stripOldGtm(injectPoints.body_end ?? '') ? '\n' + stripOldGtm(injectPoints.body_end ?? '') : '')
                        const updated = { ...injectPoints, head: newHead, body_end: newBodyEnd }
                        setInjectPoints(updated)
                        injectPointsRef.current = updated
                        await saveInjectPoints(updated)
                        setGtmSaving('saved')
                        setTimeout(() => setGtmSaving('idle'), 2000)
                      }

                      const removeGtm = async () => {
                        const stripOldGtm = (s: string) => s.replace(/<!-- Google Tag Manager[\s\S]*?<!-- End Google Tag Manager[^\n]*-->\n?/g, '').trim()
                        const updated = { ...injectPoints }
                        const newHead = stripOldGtm(injectPoints.head ?? '')
                        const newBody = stripOldGtm(injectPoints.body_end ?? '')
                        if (newHead) updated.head = newHead; else delete updated.head
                        if (newBody) updated.body_end = newBody; else delete updated.body_end
                        setInjectPoints(updated)
                        injectPointsRef.current = updated
                        setGtmId('')
                        await saveInjectPoints(updated)
                      }

                      return (
                        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* GTM logo */}
                            <svg width="28" height="28" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="8" fill="#4285F4"/><path d="M32 12L12 32l8 8 12-12 12 12 8-8z" fill="white"/><rect x="28" y="36" width="8" height="16" rx="2" fill="white"/></svg>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: C.text }}>Google Tag Manager</div>
                              <div style={{ fontSize: '0.72rem', color: C.textMuted }}>Tracciamento, analytics e conversion pixel — senza toccare il codice</div>
                            </div>
                            {isActive && (
                              <span style={{ marginLeft: 'auto', background: '#dcfce7', color: '#15803d', fontSize: '0.68rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20 }}>● Attivo</span>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              type="text"
                              value={gtmId}
                              onChange={e => setGtmId(e.target.value.toUpperCase())}
                              placeholder="GTM-XXXXXXX"
                              style={{ flex: 1, height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, background: C.white, outline: 'none', letterSpacing: '0.04em' }}
                            />
                            <button
                              onClick={saveGtm}
                              disabled={!gtmId.match(/^GTM-[A-Z0-9]+$/) || gtmSaving === 'saving'}
                              style={{ height: 32, padding: '0 16px', background: (!gtmId.match(/^GTM-[A-Z0-9]+$/) || gtmSaving === 'saving') ? C.border : C.blue, color: 'white', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                            >
                              {gtmSaving === 'saving' ? '💾…' : gtmSaving === 'saved' ? '✓ Salvato' : 'Attiva'}
                            </button>
                            {isActive && (
                              <button
                                onClick={removeGtm}
                                style={{ height: 32, padding: '0 12px', background: 'none', color: '#ef4444', border: `1px solid #fecaca`, borderRadius: 7, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >Rimuovi</button>
                            )}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: C.textFaint }}>
                            Inserisci il tuo Container ID (es. GTM-ABC1234). Lo snippet verrà iniettato automaticamente in {'<head>'} e dopo {'<body>'} su tutte le pagine.
                          </div>
                        </div>
                      )
                    })()}

                    {/* ── Immagine OG di default ── */}
                    <div style={{ marginTop: '28px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, marginBottom: '12px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>Immagine OG di default</span>
                      </div>
                      <p style={{ margin: '0 0 12px', fontSize: '0.74rem', color: C.textFaint, lineHeight: 1.5 }}>
                        Usata come <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>og:image</code> per le pagine che non ne hanno una propria. Auto-ridimensionata a 1200×630.
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        {defaultOgImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={defaultOgImage} alt="OG default" style={{ width: '120px', height: '63px', objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }} />
                        ) : (
                          <div style={{ width: '120px', height: '63px', borderRadius: 6, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: C.textFaint }}>nessuna</div>
                        )}
                        <button onClick={() => setDefaultOgPickerOpen(!defaultOgPickerOpen)} style={{ height: 32, padding: '0 14px', background: C.blue, color: 'white', border: 'none', borderRadius: 7, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {defaultOgImage ? 'Cambia' : 'Scegli immagine'}
                        </button>
                        {defaultOgImage && (
                          <button onClick={() => void saveDefaultOgImage('')} style={{ height: 32, padding: '0 12px', background: 'none', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 7, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Rimuovi</button>
                        )}
                      </div>
                      {defaultOgPickerOpen && (
                        <div style={{ marginTop: '10px', padding: '10px 12px', background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                          <div style={{ fontSize: '0.68rem', color: C.textFaint, marginBottom: '8px' }}>Scegli dalla media library</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {mediaItems.slice(0, 16).map(item => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={item.path} src={item.url} alt="" onClick={() => { void saveDefaultOgImage(item.url); setDefaultOgPickerOpen(false) }}
                                style={{ width: '48px', height: '32px', objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: defaultOgImage === item.url ? '2px solid #2563eb' : `1px solid ${C.border}` }} />
                            ))}
                            {mediaItems.length === 0 && <span style={{ fontSize: '0.72rem', color: C.textFaint }}>Nessuna immagine in libreria. Caricane una dal tab Media.</span>}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Redirect 301 ── */}
                    <div style={{ marginTop: '28px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, marginBottom: '12px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>Redirect 301</span>
                        {redirectSaving && <span style={{ fontSize: '0.72rem', color: C.textFaint }}>Salvataggio…</span>}
                      </div>
                      <p style={{ margin: '0 0 12px', fontSize: '0.74rem', color: C.textFaint, lineHeight: 1.5 }}>
                        Reindirizza vecchi URL verso nuove destinazioni (301 permanente). Utile dopo migrazioni o pagine rimosse.
                      </p>

                      {/* Built-in (automatic) redirects — read-only */}
                      {(() => {
                        const builtins = [
                          { from: '/login', to: `https://app.${ROOT_DOMAIN}/login` },
                          { from: '/registro', to: `https://app.${ROOT_DOMAIN}/registro` },
                          { from: '/*.html', to: '/* → slug senza .html' },
                        ]
                        return (
                          <div style={{ marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.66rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Predefiniti (automatici)</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {builtins.map(r => (
                                <div key={r.from} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7 }}>
                                  <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '1px 6px', borderRadius: 99, flexShrink: 0 }}>AUTO</span>
                                  <code style={{ fontSize: '0.76rem', color: C.text, fontFamily: 'monospace' }}>{r.from}</code>
                                  <span style={{ color: C.textFaint, fontSize: '0.8rem' }}>→</span>
                                  <code style={{ fontSize: '0.76rem', color: '#15803d', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.to}</code>
                                  <span title="301 attivo · gestito dal sistema" style={{ fontSize: '0.8rem', flexShrink: 0 }}>🔒</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Custom redirects */}
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Personalizzati</div>
                      {redirects.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                          {redirects.map(r => (
                            <div key={r.from} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 7 }}>
                              <code style={{ fontSize: '0.76rem', color: C.text, fontFamily: 'monospace' }}>{r.from}</code>
                              <span style={{ color: C.textFaint, fontSize: '0.8rem' }}>→</span>
                              <code style={{ fontSize: '0.76rem', color: C.blue, fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.to}</code>
                              <button onClick={() => removeRedirect(r.from)} title="Rimuovi" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', cursor: 'pointer', color: '#ef4444', flexShrink: 0 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: '0 0 12px', fontSize: '0.72rem', color: C.textFaint, fontStyle: 'italic' }}>Nessun redirect personalizzato. Aggiungine uno qui sotto.</p>
                      )}

                      {/* Add form */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={newRedirectFrom}
                          onChange={e => setNewRedirectFrom(e.target.value)}
                          placeholder="/vecchia-pagina"
                          style={{ flex: '1 1 140px', minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', fontSize: '0.78rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const }}
                        />
                        <span style={{ color: C.textFaint, fontSize: '0.85rem' }}>→</span>
                        <input
                          value={newRedirectTo}
                          onChange={e => setNewRedirectTo(e.target.value)}
                          placeholder="https://… oppure /nuova-pagina"
                          onKeyDown={e => { if (e.key === 'Enter') void addRedirect() }}
                          style={{ flex: '2 1 200px', minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', fontSize: '0.78rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const }}
                        />
                        <button
                          onClick={() => void addRedirect()}
                          disabled={!newRedirectFrom.trim() || !newRedirectTo.trim()}
                          style={{ background: C.blue, color: 'white', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: (newRedirectFrom.trim() && newRedirectTo.trim()) ? 'pointer' : 'not-allowed', opacity: (newRedirectFrom.trim() && newRedirectTo.trim()) ? 1 : 0.5, fontFamily: 'inherit', flexShrink: 0 }}
                        >Aggiungi</button>
                      </div>
                      <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: C.textFaint }}>I redirect sono attivi subito sul sito pubblicato — non serve ripubblicare.</p>
                    </div>

                      </div>
                    )}

                    {/* ── Tab: sitemap ── */}
                    {seoSubTab === 'sitemap' && (() => {
                      // Public URL shown to user (for Search Console).
                      const publicDomain = customDomain && !customDomain.startsWith('www.') ? `www.${customDomain}` : customDomain
                      const sitemapUrl = (() => {
                        const rootProject = process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
                        const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
                        if (rootProject && projectSlug === rootProject) return `https://www.${rootDomain}/sitemap.xml`
                        if (customDomain && customDomainStatus === 'verified') return `https://${publicDomain}/sitemap.xml`
                        return `/preview/${projectSlug}/sitemap.xml`
                      })()
                      // Internal API URL for download (same-origin, no CORS issues)
                      const sitemapApiUrl = `/api/seo-files?slug=${encodeURIComponent(projectSlug)}&file=sitemap.xml`

                      const downloadSitemap = async () => {
                        if (sitemapDownloading) return
                        setSitemapDownloading(true)
                        try {
                          const resp = await fetch(sitemapApiUrl)
                          const blob = await resp.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = 'sitemap.xml'
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                          URL.revokeObjectURL(url)
                        } catch (err) {
                          console.error('[Sitemap download]', err)
                        } finally {
                          setSitemapDownloading(false)
                        }
                      }

                      const copyUrl = () => {
                        const fullUrl = sitemapUrl.startsWith('/') ? `${window.location.origin}${sitemapUrl}` : sitemapUrl
                        const doWrite = (text: string) => {
                          setSitemapCopied(true)
                          setTimeout(() => setSitemapCopied(false), 2000)
                          if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(text).catch(() => {
                              // fallback: textarea trick
                              const ta = document.createElement('textarea')
                              ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'
                              document.body.appendChild(ta); ta.select()
                              document.execCommand('copy'); ta.remove()
                            })
                          } else {
                            const ta = document.createElement('textarea')
                            ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'
                            document.body.appendChild(ta); ta.select()
                            document.execCommand('copy'); ta.remove()
                          }
                        }
                        doWrite(fullUrl)
                      }

                      return (
                        <div>
                          {/* Card header */}
                          <div style={{ marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 700, color: C.text }}>Sitemap XML</h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: C.textFaint }}>
                              Generata automaticamente da tutte le pagine pubblicate. Aggiornata ad ogni salvataggio.
                            </p>
                          </div>

                          {/* URL preview */}
                          <div style={{
                            padding: '10px 14px', borderRadius: '8px',
                            background: C.bgPanel, border: `1px solid ${C.border}`,
                            fontFamily: 'monospace', fontSize: '0.82rem', color: C.text,
                            wordBreak: 'break-all', marginBottom: '14px',
                          }}>
                            {sitemapUrl.startsWith('/') ? `${typeof window !== 'undefined' ? window.location.origin : ''}${sitemapUrl}` : sitemapUrl}
                          </div>

                          {/* Action buttons */}
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                            <button
                              onClick={downloadSitemap}
                              disabled={sitemapDownloading}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '7px 14px', borderRadius: '7px',
                                border: `1px solid ${C.border}`,
                                background: sitemapDownloading ? C.bgPanel : C.white,
                                color: sitemapDownloading ? C.textFaint : C.text,
                                fontSize: '0.8rem', fontWeight: 600,
                                cursor: sitemapDownloading ? 'wait' : 'pointer',
                                fontFamily: 'inherit', transition: 'all 0.15s',
                              }}
                            >
                              {sitemapDownloading ? '⏳ Download…' : '📥 Scarica sitemap.xml'}
                            </button>
                            <button
                              onClick={copyUrl}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '7px 14px', borderRadius: '7px',
                                border: `1px solid ${sitemapCopied ? '#86efac' : C.border}`,
                                background: sitemapCopied ? '#f0fdf4' : C.white,
                                color: sitemapCopied ? '#16a34a' : C.text,
                                fontSize: '0.8rem', fontWeight: 600,
                                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                              }}
                            >
                              {sitemapCopied ? '✓ Copiato!' : '📋 Copia URL'}
                            </button>
                            <a
                              href={sitemapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '7px 14px', borderRadius: '7px',
                                border: `1px solid ${C.border}`,
                                background: C.white, color: C.text,
                                fontSize: '0.8rem', fontWeight: 600,
                                cursor: 'pointer', fontFamily: 'inherit',
                                textDecoration: 'none', transition: 'all 0.15s',
                              }}
                            >
                              🔍 Visualizza
                            </a>
                          </div>

                          {/* Google Search Console hint */}
                          <div style={{
                            padding: '10px 14px', borderRadius: '8px',
                            background: '#eff6ff', border: '1px solid #bfdbfe',
                            fontSize: '0.75rem', color: '#1d4ed8', lineHeight: 1.5,
                            marginBottom: '20px',
                          }}>
                            💡 Incolla questo URL in <strong>Google Search Console → Sitemap</strong> per indicizzare tutte le pagine.
                          </div>

                          {/* Pages list */}
                          <div style={{ marginBottom: '28px' }}>
                            <div style={{
                              fontSize: '0.78rem', fontWeight: 700, color: C.text,
                              marginBottom: '8px', padding: '6px 0', borderBottom: `1px solid ${C.border}`,
                            }}>
                              Pagine incluse ({pages.filter(p => p.inMenu !== false && p.inMenu !== null && !p.robots?.noindex).length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {pages.filter(p => p.inMenu !== false && p.inMenu !== null && !p.robots?.noindex).map(p => (
                                <div key={p.slug} style={{
                                  display: 'flex', alignItems: 'center', gap: '8px',
                                  padding: '6px 10px', borderRadius: '6px',
                                  background: C.bgPanel, border: `1px solid ${C.borderLight}`,
                                  fontSize: '0.78rem',
                                }}>
                                  <span style={{ color: C.textFaint, flexShrink: 0 }}>📄</span>
                                  <span style={{ fontFamily: 'monospace', color: C.text }}>
                                    {p.slug === 'home' ? '/' : `/${p.slug}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* ── llms.txt ── */}
                          {(() => {
                            const llmsUrl = (() => {
                              const rootProject = process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
                              const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
                              if (rootProject && projectSlug === rootProject) return `https://www.${rootDomain}/llms.txt`
                              if (customDomain && customDomainStatus === 'verified') return `https://${publicDomain}/llms.txt`
                              return `/preview/${projectSlug}/llms.txt`
                            })()
                            return (
                              <div style={{ marginBottom: '28px' }}>
                                <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 700, color: C.text }}>llms.txt</h3>
                                <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: C.textFaint }}>
                                  Sommario del sito in markdown per AI assistant (Claude, ChatGPT, Perplexity). Standard llmstxt.org.
                                </p>
                                <div style={{ padding: '10px 14px', borderRadius: '8px', background: C.bgPanel, border: `1px solid ${C.border}`, fontFamily: 'monospace', fontSize: '0.82rem', color: C.text, wordBreak: 'break-all', marginBottom: '12px' }}>
                                  {llmsUrl.startsWith('/') ? `${typeof window !== 'undefined' ? window.location.origin : ''}${llmsUrl}` : llmsUrl}
                                </div>
                                <a href={llmsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '7px', border: `1px solid ${C.border}`, background: C.white, color: C.text, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}>
                                  🔍 Visualizza
                                </a>
                              </div>
                            )
                          })()}

                          {/* ── Robots.txt ── */}
                          {(() => {
                            const robotsUrl = (() => {
                              const rootProject = process.env.NEXT_PUBLIC_ROOT_DOMAIN_PROJECT ?? ''
                              const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'factulista.com'
                              if (rootProject && projectSlug === rootProject) return `https://www.${rootDomain}/robots.txt`
                              if (customDomain && customDomainStatus === 'verified') return `https://${publicDomain}/robots.txt`
                              return `/preview/${projectSlug}/robots.txt`
                            })()
                            return (
                              <div>
                                <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 700, color: C.text }}>Robots.txt</h3>
                                <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: C.textFaint }}>
                                  Istruzioni per i motori di ricerca. Pagine bozza escluse automaticamente.
                                </p>
                                <div style={{
                                  padding: '10px 14px', borderRadius: '8px',
                                  background: C.bgPanel, border: `1px solid ${C.border}`,
                                  fontFamily: 'monospace', fontSize: '0.82rem', color: C.text,
                                  wordBreak: 'break-all', marginBottom: '12px',
                                }}>
                                  {robotsUrl.startsWith('/') ? `${typeof window !== 'undefined' ? window.location.origin : ''}${robotsUrl}` : robotsUrl}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  <button
                                    onClick={() => {
                                      const full = robotsUrl.startsWith('/') ? `${window.location.origin}${robotsUrl}` : robotsUrl
                                      navigator.clipboard?.writeText(full).catch(() => {})
                                      setRobotsCopied(true)
                                      setTimeout(() => setRobotsCopied(false), 2000)
                                    }}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                                      padding: '7px 14px', borderRadius: '7px',
                                      border: `1px solid ${robotsCopied ? '#86efac' : C.border}`,
                                      background: robotsCopied ? '#f0fdf4' : C.white,
                                      color: robotsCopied ? '#16a34a' : C.text,
                                      fontSize: '0.8rem', fontWeight: 600,
                                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                                    }}
                                  >
                                    {robotsCopied ? '✓ Copiato!' : '📋 Copia URL'}
                                  </button>
                                  <a href={robotsUrl} target="_blank" rel="noopener noreferrer" style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    padding: '7px 14px', borderRadius: '7px',
                                    border: `1px solid ${C.border}`,
                                    background: C.white, color: C.text,
                                    fontSize: '0.8rem', fontWeight: 600,
                                    cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
                                  }}>
                                    🔍 Visualizza
                                  </a>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })()}

                    {/* ── Tab: keywords ── */}
                    {seoSubTab === 'keywords' && (() => {
                      const KW_PAGE_SIZE = 50

                      const saveKeywords = async (kws: typeof seoKeywords) => {
                        setSeoKeywords(kws)
                        const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
                        await supabase.from('projects').update({
                          site_config: { ...(proj?.site_config ?? {}), keywords: kws },
                          updated_at: new Date().toISOString(),
                        }).eq('id', id)
                      }

                      const parseCSV = (text: string) => {
                        const clean = text.replace(/\x00/g, '').replace(/^﻿/, '')
                        const lines = clean.split(/\r?\n/).filter(l => l.trim())
                        if (lines.length < 2) return []
                        const sep = lines[0].includes('\t') ? '\t' : ','
                        const headers = lines[0].split(sep).map(h => h.trim().replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase())
                        const idx = (name: string) => headers.findIndex(h => h.includes(name))
                        const kwIdx = (() => { const i = idx('keyword'); return i >= 0 ? i : idx('parola') })()
                        const volIdx = (() => { const i = headers.findIndex(h => h.includes('volume') && !h.includes('global') && !h.includes('traffic')); return i >= 0 ? i : idx('vol') })()
                        const diffIdx = idx('diff')
                        const intentIdx = idx('intent')
                        const parentIdx = idx('parent')
                        if (kwIdx < 0) return []
                        return lines.slice(1).map(line => {
                          const cols = line.split(sep).map(c => c.trim().replace(/^["'\s]+|["'\s]+$/g, ''))
                          const kw = cols[kwIdx] || ''
                          if (!kw) return null
                          return {
                            keyword: kw,
                            volume: parseInt(cols[volIdx] || '0') || 0,
                            difficulty: parseInt(cols[diffIdx] || '0') || 0,
                            intent: intentIdx >= 0 ? cols[intentIdx] : undefined,
                            parentKeyword: parentIdx >= 0 ? cols[parentIdx] : undefined,
                          }
                        }).filter(Boolean) as typeof seoKeywords
                      }

                      // Sorted base (by volume, used to determine top-25 badge)
                      const sortedByVolume = [...seoKeywords].sort((a, b) => b.volume - a.volume)
                      const top25Set = new Set(sortedByVolume.slice(0, 25).map(k => k.keyword))

                      // Unique intents for filter dropdown
                      const allIntents = Array.from(new Set(
                        seoKeywords.map(k => k.intent?.split(',')[0]?.trim() || '').filter(Boolean)
                      )).sort()

                      // Apply filters + sort
                      const filtered = seoKeywords
                        .filter(k => !kwSearch || k.keyword.toLowerCase().includes(kwSearch.toLowerCase()))
                        .filter(k => !kwIntentFilter || k.intent?.toLowerCase().includes(kwIntentFilter.toLowerCase()))
                        .sort((a, b) => kwVolSort === 'desc' ? b.volume - a.volume : a.volume - b.volume)

                      const totalPages = Math.ceil(filtered.length / KW_PAGE_SIZE)
                      const paginated = filtered.slice(kwPage * KW_PAGE_SIZE, (kwPage + 1) * KW_PAGE_SIZE)

                      const Pagination = () => totalPages > 1 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: C.textFaint }}>
                          <button onClick={() => setKwPage(p => Math.max(0, p-1))} disabled={kwPage === 0}
                            style={{ padding: '3px 8px', borderRadius: '5px', border: `1px solid ${C.border}`, background: kwPage === 0 ? C.bgPanel : C.white, cursor: kwPage === 0 ? 'default' : 'pointer', color: kwPage === 0 ? C.textFaint : C.text, fontFamily: 'inherit', fontSize: '0.78rem' }}>‹</button>
                          <span>Pag. {kwPage + 1} / {totalPages}</span>
                          <button onClick={() => setKwPage(p => Math.min(totalPages-1, p+1))} disabled={kwPage >= totalPages-1}
                            style={{ padding: '3px 8px', borderRadius: '5px', border: `1px solid ${C.border}`, background: kwPage >= totalPages-1 ? C.bgPanel : C.white, cursor: kwPage >= totalPages-1 ? 'default' : 'pointer', color: kwPage >= totalPages-1 ? C.textFaint : C.text, fontFamily: 'inherit', fontSize: '0.78rem' }}>›</button>
                          <span style={{ marginLeft: '4px' }}>{filtered.length} risultati</span>
                        </div>
                      ) : null

                      return (
                        <div>
                          <div style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 700, color: C.text }}>Keyword SEO</h3>
                            <p style={{ margin: 0, fontSize: '0.78rem', color: C.textFaint }}>
                              Carica le keyword da Ahrefs, SEMrush o Seozoom. Vengono usate da tutti gli agenti per ottimizzare titoli, meta e testi.
                            </p>
                          </div>

                          {/* Upload */}
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '7px', border: `1px solid ${C.border}`, background: C.white, color: C.text, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {keywordsUploading ? '⏳ Caricamento…' : '📂 Carica CSV'}
                              <input type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }}
                                onChange={async e => {
                                  const file = e.target.files?.[0]; if (!file) return
                                  setKeywordsUploading(true)
                                  try {
                                    const text = await file.text()
                                    const kws = parseCSV(text)
                                    if (kws.length === 0) { alert('Nessuna keyword trovata. Assicurati che il CSV abbia una colonna "Keyword".'); return }
                                    await saveKeywords(kws); setKwPage(0)
                                  } finally { setKeywordsUploading(false); e.target.value = '' }
                                }} />
                            </label>
                            {seoKeywords.length > 0 && (
                              <button onClick={async () => { if (confirm('Eliminare tutte le keyword?')) { await saveKeywords([]); setKwPage(0) } }}
                                style={{ padding: '7px 14px', borderRadius: '7px', border: '1px solid #fca5a5', background: '#fff5f5', color: '#dc2626', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                                🗑 Cancella tutto
                              </button>
                            )}
                          </div>

                          {seoKeywords.length === 0 ? (
                            <div style={{ padding: '32px', textAlign: 'center', borderRadius: '10px', border: `2px dashed ${C.border}`, color: C.textFaint, fontSize: '0.82rem' }}>
                              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🎯</div>
                              Nessuna keyword. Carica un CSV da Ahrefs, SEMrush o Seozoom.
                            </div>
                          ) : (
                            <div>
                              {/* Filters row */}
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
                                  <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', pointerEvents: 'none' }}>🔍</span>
                                  <input value={kwSearch} onChange={e => { setKwSearch(e.target.value); setKwPage(0) }}
                                    placeholder="Cerca keyword…"
                                    style={{ width: '100%', paddingLeft: '28px', paddingRight: '8px', paddingTop: '6px', paddingBottom: '6px', borderRadius: '7px', border: `1px solid ${C.border}`, fontSize: '0.78rem', fontFamily: 'inherit', background: C.white, color: C.text, boxSizing: 'border-box' }} />
                                </div>
                                <select value={kwIntentFilter} onChange={e => { setKwIntentFilter(e.target.value); setKwPage(0) }}
                                  style={{ padding: '6px 10px', borderRadius: '7px', border: `1px solid ${C.border}`, fontSize: '0.78rem', fontFamily: 'inherit', background: C.white, color: kwIntentFilter ? C.text : C.textFaint, cursor: 'pointer' }}>
                                  <option value="">Tutti gli intent</option>
                                  {allIntents.map(i => <option key={i} value={i}>{i}</option>)}
                                </select>
                                <div style={{ fontSize: '0.75rem', color: C.textFaint, marginLeft: 'auto' }}>
                                  {seoKeywords.length} kw · <span style={{ color: '#6366f1' }}>●</span> top 25 usate dagli agenti
                                </div>
                              </div>

                              {/* Pagination top */}
                              {totalPages > 1 && <div style={{ marginBottom: '8px' }}><Pagination /></div>}

                              <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                  <thead>
                                    <tr style={{ background: C.bgPanel, borderBottom: `1px solid ${C.border}` }}>
                                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: C.textFaint }}>Keyword</th>
                                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: C.text, width: '80px', cursor: 'pointer', userSelect: 'none' }}
                                        onClick={() => { setKwVolSort(s => s === 'desc' ? 'asc' : 'desc'); setKwPage(0) }}>
                                        Volume {kwVolSort === 'desc' ? '↓' : '↑'}
                                      </th>
                                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: C.textFaint, width: '60px' }}>Diff.</th>
                                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: C.textFaint, width: '110px' }}>Intent</th>
                                      <th style={{ padding: '8px 6px', width: '30px' }}></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {paginated.map((kw, i) => {
                                      const globalIdx = kwPage * KW_PAGE_SIZE + i
                                      const isTop25 = top25Set.has(kw.keyword)
                                      return (
                                        <tr key={i} style={{ borderBottom: `1px solid ${C.borderLight}`, background: i % 2 === 0 ? C.white : C.bgPanel }}>
                                          <td style={{ padding: '7px 10px', color: C.text, fontWeight: isTop25 ? 600 : 400 }}>
                                            {isTop25 && <span style={{ color: '#6366f1', marginRight: '4px', fontSize: '0.65rem' }}>●</span>}
                                            {kw.keyword}
                                          </td>
                                          <td style={{ padding: '7px 10px', textAlign: 'right', color: C.textFaint, fontFamily: 'monospace' }}>
                                            {kw.volume >= 1000 ? `${(kw.volume/1000).toFixed(0)}k` : kw.volume || '—'}
                                          </td>
                                          <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                                            {kw.difficulty ? <span style={{ padding: '1px 5px', borderRadius: '4px', fontSize: '0.72rem', background: kw.difficulty > 50 ? '#fee2e2' : kw.difficulty > 25 ? '#fef3c7' : '#dcfce7', color: kw.difficulty > 50 ? '#dc2626' : kw.difficulty > 25 ? '#d97706' : '#16a34a' }}>{kw.difficulty}</span> : <span style={{ color: C.textFaint }}>—</span>}
                                          </td>
                                          <td style={{ padding: '7px 10px', color: C.textFaint, fontSize: '0.72rem' }}>
                                            {kw.intent?.split(',')[0]?.trim().split(' ')[0] || ''}
                                          </td>
                                          <td style={{ padding: '7px 6px', textAlign: 'center' }}>
                                            <button onClick={() => saveKeywords(seoKeywords.filter(k => k.keyword !== kw.keyword))}
                                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '0.8rem', padding: '0 2px' }}>×</button>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              {/* Pagination bottom */}
                              {totalPages > 1 && <div style={{ marginTop: '10px' }}><Pagination /></div>}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                  </div>
                </div>
              </div>
            )
          })()
        ) : viewMode === 'edit' && activePage ? (
          /* Inline editor v2 — contentEditable inside iframe */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.72rem', color: C.textFaint }}>
                    ✎ Clicca sul testo per modificarlo
                  </span>
                  <button
                    onClick={() => editIframeRef.current?.contentWindow?.postMessage({ type: 'fact-structure-toggle' }, '*')}
                    title={showStructurePanel ? 'Nascondi overlay struttura' : 'Mostra overlay struttura pagina'}
                    style={{
                      background: showStructurePanel ? C.blue : C.bg,
                      color: showStructurePanel ? 'white' : C.textFaint,
                      border: `1px solid ${showStructurePanel ? C.blue : C.border}`,
                      borderRadius: 5,
                      padding: '2px 8px',
                      fontSize: '0.68rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                      <rect x="1" y="1" width="10" height="3" rx="0.5"/>
                      <rect x="1" y="5" width="10" height="3" rx="0.5"/>
                      <rect x="1" y="9" width="6" height="2" rx="0.5"/>
                    </svg>
                    Struttura
                  </button>
                </div>
                <span style={{ fontSize: '0.72rem', color: editSaving === 'saving' ? '#f59e0b' : editSaving === 'saved' ? '#10b981' : editSaving === 'failed' ? '#dc2626' : C.textFaint, fontWeight: editSaving === 'failed' ? 600 : 400 }}>
                  {editSaving === 'saving' ? '⏳ Salvataggio...' : editSaving === 'saved' ? '✓ Salvato' : editSaving === 'failed' ? '⚠ Salvataggio fallito — controlla console' : 'Auto-save attivo'}
                </span>
              </div>

              {/* ── Inline editor formatting toolbar ── */}
              {(() => {
                const win = () => editIframeRef.current?.contentWindow
                const fmt = (cmd: string, val?: string) => win()?.postMessage({ type: 'fact-format', cmd, val }, '*')
                const handleInlineImageUpload = async (file: File) => {
                  if (!file.type.startsWith('image/')) return
                  const { data: { session } } = await supabase.auth.getSession()
                  if (!session) return
                  const ext = file.name.split('.').pop() || 'png'
                  const path = `${session.user.id}/${id}/inline-${Date.now()}.${ext}`
                  const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
                  if (error) return
                  const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
                  const imgHtml = buildImageHtml(publicUrl)
                  win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: imgHtml }, '*')
                  // Generate SEO meta for the media library entry (non-blocking)
                  generateAndSaveImageMeta(path, publicUrl)
                }
                const dropMenu: React.CSSProperties = {
                  position: 'absolute', top: '100%', left: 0, zIndex: 9999,
                  background: '#fff', border: `1px solid ${C.border}`,
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  padding: '4px', minWidth: '180px', marginTop: '3px',
                }
                return (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderBottom: `1px solid ${C.border}`, background: C.white, flexShrink: 0, flexWrap: 'wrap', minHeight: '42px' }}
                    onClick={() => { setInlineListOpen(false); setInlineInsertOpen(false); setInlineAlignOpen(false) }}
                  >
                    {/* Undo / Redo */}
                    <button title="Annulla (Ctrl+Z)" onMouseDown={e => { e.preventDefault(); fmt('undo') }}
                      style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
                    </button>
                    <button title="Ripristina (Ctrl+Shift+Z)" onMouseDown={e => { e.preventDefault(); fmt('redo') }}
                      style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>
                    </button>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Font picker */}
                    <select
                      title="Scegli font"
                      value={inlineFontName}
                      onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                      onChange={e => {
                        const font = e.target.value
                        if (!font) return
                        win()?.postMessage({ type: 'fact-format', cmd: 'fontName', val: font }, '*')
                      }}
                      style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'inherit', maxWidth: '110px' }}
                    >
                      <option value="">Font</option>
                      <optgroup label="Sistema">
                        <option value="Georgia">Georgia</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Arial">Arial</option>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Trebuchet MS">Trebuchet MS</option>
                        <option value="Courier New">Courier New</option>
                      </optgroup>
                      <optgroup label="Google Fonts">
                        <option value="Inter">Inter</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                        <option value="Lato">Lato</option>
                        <option value="Roboto">Roboto</option>
                        <option value="Open Sans">Open Sans</option>
                        <option value="Montserrat">Montserrat</option>
                        <option value="Merriweather">Merriweather</option>
                        <option value="Playfair Display">Playfair Display</option>
                        <option value="Source Serif 4">Source Serif 4</option>
                      </optgroup>
                    </select>

                    {/* Font size picker (pt) */}
                    <select
                      title="Dimensione testo"
                      value={inlineFontSizePt ?? ''}
                      onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                      onChange={e => {
                        const pt = e.target.value
                        if (!pt) return
                        win()?.postMessage({ type: 'fact-fontsize', pt: Number(pt) }, '*')
                      }}
                      style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'inherit', width: '68px' }}
                    >
                      <option value="">pt</option>
                      {[9,10,11,12,13,14,15,16,18,20,24,28,30,36,48,60].map(pt => (
                        <option key={pt} value={pt}>{pt} pt</option>
                      ))}
                    </select>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Color picker */}
                    <label title="Colore testo" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, height: '26px', gap: '1px', position: 'relative', userSelect: 'none' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 800, color: C.text, lineHeight: 1, pointerEvents: 'none' }}>A</span>
                      <div style={{ width: '14px', height: '3px', borderRadius: '1px', background: 'linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7)', pointerEvents: 'none' }} />
                      <input type="color" defaultValue="#000000"
                        ref={el => { inlineColorInputRef.current = el }}
                        onMouseDown={() => win()?.postMessage({ type: 'fact-save-sel' }, '*')}
                        onChange={e => win()?.postMessage({ type: 'fact-format', cmd: 'foreColor', val: e.target.value }, '*')}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none', padding: 0 }}
                      />
                    </label>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Block type */}
                    <select
                      title="Tipo di blocco"
                      value={inlineActiveBlock || 'P'}
                      onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                      onChange={e => {
                        fmt('formatBlock', e.target.value.toLowerCase())
                        setInlineListOpen(false); setInlineInsertOpen(false); setInlineAlignOpen(false)
                      }}
                      style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'monospace', fontWeight: 700, minWidth: '80px' }}
                    >
                      <option value="LI" hidden>• Elemento lista</option>
                      <option value="H1">H1 — Titolo 1</option>
                      <option value="H2">H2 — Titolo 2</option>
                      <option value="H3">H3 — Titolo 3</option>
                      <option value="H4">H4 — Titolo 4</option>
                      <option value="P">§ — Paragrafo</option>
                      <option value="BLOCKQUOTE">❝ — Citazione</option>
                      <option value="PRE">{'<>'} — Codice</option>
                    </select>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* B / I / U / S */}
                    {([
                      { label: 'B', cmd: 'bold', title: 'Grassetto (Ctrl+B)', s: { fontWeight: 800 } },
                      { label: 'I', cmd: 'italic', title: 'Corsivo (Ctrl+I)', s: { fontStyle: 'italic' as const } },
                      { label: 'U', cmd: 'underline', title: 'Sottolineato (Ctrl+U)', s: { textDecoration: 'underline' } },
                      { label: 'S', cmd: 'strikeThrough', title: 'Barrato', s: { textDecoration: 'line-through' } },
                    ]).map(b => (
                      <button key={b.cmd} title={b.title}
                        onMouseDown={e => { e.preventDefault(); fmt(b.cmd) }}
                        style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, fontSize: '0.82rem', lineHeight: 1.4, ...b.s }}
                      >{b.label}</button>
                    ))}

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Alignment dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        title="Allineamento testo"
                        onMouseDown={e => e.preventDefault()}
                        onClick={e => { e.stopPropagation(); setInlineAlignOpen(v => !v); setInlineListOpen(false); setInlineInsertOpen(false) }}
                        style={{ padding: '2px 7px', border: `1px solid ${inlineAlignOpen ? C.blue : C.border}`, borderRadius: 4, background: inlineAlignOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: inlineAlignOpen ? C.blue : C.text, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '3px', height: '26px' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                      </button>
                      {inlineAlignOpen && (
                        <div style={dropMenu} onClick={e => e.stopPropagation()}>
                          {([
                            { label: '⬅  Sinistra', cmd: 'justifyLeft' },
                            { label: '↔  Centro', cmd: 'justifyCenter' },
                            { label: '➡  Destra', cmd: 'justifyRight' },
                            { label: '⬛  Giustificato', cmd: 'justifyFull' },
                          ]).map(a => (
                            <button key={a.cmd}
                              onMouseDown={e => { e.preventDefault(); fmt(a.cmd); setInlineAlignOpen(false) }}
                              style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                            >{a.label}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Link */}
                    <button title="Inserisci / modifica link"
                      onMouseDown={e => { e.preventDefault(); win()?.postMessage({ type: 'fact-link' }, '*') }}
                      style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </button>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Liste dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        title="Liste"
                        onMouseDown={e => e.preventDefault()}
                        onClick={e => { e.stopPropagation(); setInlineListOpen(v => !v); setInlineInsertOpen(false); setInlineAlignOpen(false) }}
                        style={{ padding: '2px 7px', border: `1px solid ${inlineListOpen ? C.blue : C.border}`, borderRadius: 4, background: inlineListOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: inlineListOpen ? C.blue : C.text, display: 'flex', alignItems: 'center', gap: '3px', height: '26px' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                      </button>
                      {inlineListOpen && (
                        <div style={dropMenu} onClick={e => e.stopPropagation()}>
                          <button onMouseDown={e => { e.preventDefault(); fmt('insertUnorderedList'); setInlineListOpen(false) }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                            Elenco puntato
                          </button>
                          <button onMouseDown={e => { e.preventDefault(); fmt('insertOrderedList'); setInlineListOpen(false) }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4M3 10h2" strokeWidth="1.5"/><path d="M3 16a1.5 1.5 0 0 1 3 0c0 1.5-3 3-3 3h3" strokeWidth="1.5"/></svg>
                            Elenco numerato
                          </button>
                          <div style={{ height: 1, background: C.border, margin: '3px 0' }} />
                          <button onMouseDown={e => { e.preventDefault(); fmt('indent'); setInlineListOpen(false) }}
                            style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >→  Aumenta rientro</button>
                          <button onMouseDown={e => { e.preventDefault(); fmt('outdent'); setInlineListOpen(false) }}
                            style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >←  Diminuisci rientro</button>
                        </div>
                      )}
                    </div>

                    <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                    {/* Inserisci dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        title="Inserisci elemento"
                        onMouseDown={e => e.preventDefault()}
                        onClick={e => { e.stopPropagation(); setInlineInsertOpen(v => !v); setInlineListOpen(false); setInlineAlignOpen(false) }}
                        style={{ padding: '2px 8px', border: `1px solid ${inlineInsertOpen ? C.blue : C.border}`, borderRadius: 4, background: inlineInsertOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: inlineInsertOpen ? C.blue : C.text, fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', height: '26px', whiteSpace: 'nowrap' }}
                      >
                        + Inserisci <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                      </button>
                      {inlineInsertOpen && (
                        <div style={{ ...dropMenu, minWidth: '200px' }} onClick={e => e.stopPropagation()}>
                          <button onMouseDown={e => {
                            e.preventDefault()
                            const tableHtml = `<table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.95rem"><thead><tr><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 1</th><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 2</th><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 3</th></tr></thead><tbody><tr><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 1</td><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 2</td><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 3</td></tr><tr><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 4</td><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 5</td><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 6</td></tr></tbody></table>`
                            win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: tableHtml }, '*')
                            setInlineInsertOpen(false)
                          }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>
                            Tabella 3×2
                          </button>
                          <button onClick={() => { setInlineInsertOpen(false); setMediaPickerTarget('inline') }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            Immagine
                          </button>
                          <div style={{ height: 1, background: C.border, margin: '3px 0' }} />
                          <button onMouseDown={e => {
                            e.preventDefault()
                            win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: '<hr style="border:none;border-top:2px solid #e5e7eb;margin:2rem 0;">' }, '*')
                            setInlineInsertOpen(false)
                          }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <span style={{ fontSize: '1rem' }}>—</span>
                            Separatore (HR)
                          </button>
                          <button onMouseDown={e => {
                            e.preventDefault()
                            win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: '<pre style="background:#1e293b;color:#e2e8f0;padding:1rem 1.25rem;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:0.88rem;margin:1.5rem 0;"><code>// il tuo codice qui</code></pre>' }, '*')
                            setInlineInsertOpen(false)
                          }}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                          >
                            <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{'{}'}</span>
                            Blocco codice
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Hidden image input */}
                    <input
                      id="inline-img-file-input"
                      ref={inlineImgInputRef}
                      type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const file = e.target.files?.[0]; if (file) handleInlineImageUpload(file); e.target.value = '' }}
                    />
                  </div>
                )
              })()}
              {editOutdated && (
                <div
                  onClick={() => {
                    if (!activePage) return
                    editBaseHtmlRef.current = activePage.html
                    setEditSrcDoc(injectBase(activePage.html, projectSlug, sharedNavHtmlRef.current || undefined, sharedFooterHtmlRef.current || undefined, sharedCssRef.current || undefined, faviconUrlRef.current || undefined))
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
        ) : viewMode === 'code' ? (
          /* Code editor — no sidebar, page selected via top dropdown */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#1e1e1e' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Code editor header — file name + optional blog post selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 14px', borderBottom: '1px solid #3e3e3e', flexShrink: 0, background: '#2d2d2d' }}>
                {activeCodeBlogPostId
                  ? <span style={{ fontSize: '0.75rem', color: '#858585', fontFamily: 'monospace', flex: 1 }}>blog/{activeCodeBlogPostTitle || activeCodeBlogPostId}.html <span style={{ color: '#4b9eff', marginLeft: '8px' }}>content_html</span></span>
                  : <span style={{ fontSize: '0.75rem', color: '#858585', fontFamily: 'monospace', flex: 1 }}>{activePage?.slug ?? ''}.html</span>
                }
                {/* Blog post selector — only shown if there are blog posts */}
                {blogPosts.length > 0 && (
                  <select
                    value={activeCodeBlogPostId ?? ''}
                    onChange={async e => {
                      const postId = e.target.value
                      if (!postId) {
                        setActiveCodeBlogPostId(null)
                        setCodeContent(pages.find(p => p.slug === activeSlug)?.html ?? '')
                        setCodeSaving('idle')
                        return
                      }
                      const post = blogPosts.find(p => p.id === postId)
                      setCodeSaving('idle')
                      setActiveCodeBlogPostId(postId)
                      setActiveCodeBlogPostTitle(post?.title ?? '')
                      const { data: { session } } = await supabase.auth.getSession()
                      const token = session?.access_token
                      if (!token) return
                      const res = await fetch(`/api/blog-posts/${postId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
                      const json = await res.json()
                      setCodeContent(prettifyHtml(json.post?.content_html ?? ''))
                    }}
                    style={{ fontSize: '0.72rem', background: '#3e3e3e', color: '#ccc', border: '1px solid #555', borderRadius: '5px', padding: '3px 6px', fontFamily: 'monospace', cursor: 'pointer', maxWidth: '200px' }}
                  >
                    <option value="">— pagina —</option>
                    <optgroup label="Articoli blog">
                      {blogPosts.map(p => (
                        <option key={p.id} value={p.id}>{p.title.slice(0, 40)}</option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </div>
              <HtmlCodeEditor
                content={codeContent}
                onChange={async (val) => {
                  setCodeContent(val)
                  setCodeSaving('idle')
                  if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current)
                  if (activeCodeBlogPostId) {
                    // Blog post: debounce PATCH to blog-posts API
                    const postId = activeCodeBlogPostId
                    codeAutoSaveTimer.current = setTimeout(async () => {
                      setCodeSaving('saving')
                      const { data: { session } } = await supabase.auth.getSession()
                      const token = session?.access_token
                      if (!token) return
                      await fetch(`/api/blog-posts/${postId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ content_html: val }),
                      })
                      setCodeSaving('saved')
                      setTimeout(() => setCodeSaving('idle'), 2000)
                    }, 2000)
                  } else {
                    // Regular page: update pages state + debounce saveState
                    if (!activePage) return
                    const newPages = pages.map(p => p.slug === activePage.slug ? { ...p, html: val } : p)
                    setPages(newPages)
                    codeAutoSaveTimer.current = setTimeout(async () => {
                      setCodeSaving('saving')
                      const curPages = latestPagesRef.current
                      void createVersion('Modifica HTML manuale', curPages)
                      await saveState(messages, curPages)
                      setCodeSaving('saved')
                      setTimeout(() => setCodeSaving('idle'), 2000)
                    }, 2000)
                  }
                }}
                onSave={async (content) => {
                  setCodeSaving('saving')
                  if (activeCodeBlogPostId) {
                    const { data: { session } } = await supabase.auth.getSession()
                    const token = session?.access_token
                    if (!token) return
                    await fetch(`/api/blog-posts/${activeCodeBlogPostId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ content_html: content }),
                    })
                  } else {
                    if (!activePage) return
                    const newPages = pages.map(p => p.slug === activePage.slug ? { ...p, html: content } : p)
                    setPages(newPages)
                    latestPagesRef.current = newPages
                    void createVersion('Modifica HTML manuale', newPages)
                    await saveState(messages, newPages)
                  }
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
                            {item.url === faviconUrl && (
                              <div style={{
                                position: 'absolute', bottom: '4px', left: '4px',
                                background: '#2563eb', color: 'white',
                                fontSize: '0.6rem', fontWeight: 700,
                                padding: '1px 5px', borderRadius: '3px',
                              }}>🌐 favicon</div>
                            )}
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
                  {/* Favicon action */}
                  <div style={{ marginBottom: '14px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#9b9896', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Usa come</div>
                    <button
                      type="button"
                      onClick={() => saveFaviconUrl(selectedMedia.url)}
                      disabled={faviconSaving === 'saving'}
                      style={{
                        width: '100%', padding: '7px 10px',
                        background: faviconSaving === 'saved' ? '#dcfce7' : selectedMedia.url === faviconUrl ? '#dbeafe' : 'white',
                        border: `1px solid ${faviconSaving === 'saved' ? '#16a34a' : selectedMedia.url === faviconUrl ? '#2563eb' : '#e5e7eb'}`,
                        borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600,
                        color: faviconSaving === 'saved' ? '#15803d' : selectedMedia.url === faviconUrl ? '#1d4ed8' : '#374151',
                        cursor: faviconSaving === 'saving' ? 'wait' : 'pointer',
                        fontFamily: 'inherit', textAlign: 'left' as const,
                        display: 'flex', alignItems: 'center', gap: '6px',
                      }}
                    >
                      {faviconSaving === 'saving' ? '⏳ ' : faviconSaving === 'saved' ? '✓ Salvato!' : selectedMedia.url === faviconUrl ? '✓ ' : ''}{faviconSaving !== 'saved' ? '🌐 Favicon del progetto' : ''}
                    </button>
                  </div>
                  {/* ✨ AI wand — fill empty meta fields */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.67rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Metadati immagine</span>
                    <button
                      type="button"
                      onClick={() => generateImageMetaFillEmpty(selectedMedia.path, selectedMedia.url)}
                      disabled={mediaAiGenerating}
                      title="Genera automaticamente con AI i campi vuoti"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '4px 10px', borderRadius: '20px',
                        border: `1px solid ${mediaAiGenerating ? C.border : '#c4b5fd'}`,
                        background: mediaAiGenerating ? C.bgPanel : '#faf5ff',
                        color: mediaAiGenerating ? C.textFaint : '#7c3aed',
                        fontSize: '0.72rem', fontWeight: 600,
                        cursor: mediaAiGenerating ? 'wait' : 'pointer',
                        fontFamily: 'inherit', transition: 'all 0.15s',
                      }}
                    >
                      {mediaAiGenerating
                        ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Generando…</>
                        : <>✨ Genera con AI</>}
                    </button>
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
        ) : viewMode === 'blog' ? (
          /* ── Blog Manager ───────────────────────────────────────────────────── */
          (() => {
            const openPost = async (post: BlogPost) => {
              // CRITICAL: flush any pending autosave BEFORE fetching, so we don't
              // race the API GET against an in-flight save of older content
              await flushBlogSave()
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) return
              let full: BlogPost = post
              try {
                const res = await fetch(`/api/blog-posts/${post.id}`, {
                  headers: { Authorization: `Bearer ${token}` },
                  cache: 'no-store',
                })
                if (!res.ok) {
                  alert(`Impossibile aprire l'articolo (${res.status}). Potrebbe essere stato eliminato.`)
                  await loadBlogPosts()
                  return
                }
                const json = await res.json()
                full = json.post ?? post
                console.log('[parent-blog] openPost fetched fresh content, length:', (full.content_html ?? '').length, 'preview:', (full.content_html ?? '').slice(0, 200))
              } catch (err) {
                console.error('openPost error:', err)
                alert('Errore di rete nel caricamento dell\'articolo')
                return
              }
              setSelectedPost(full)
              setBlogMetaEdits({})
              // Build editor srcdoc — uses the same CSS as the live blog preview
              // Strip any accumulated wrapper divs from legacy saves
              let contentHtml = full.content_html ?? ''
              try {
                const parser = new DOMParser()
                const doc = parser.parseFromString(`<div id="__wrap">${contentHtml}</div>`, 'text/html')
                const allContent = doc.querySelectorAll('.blog-post-content')
                if (allContent.length > 0) {
                  contentHtml = allContent[allContent.length - 1].innerHTML.trim()
                }
              } catch { /* keep original */ }
              // Extract ONLY CSS custom properties (:root variables) + Google Font links from
              // the home page — NOT the full page CSS. Injecting the full site CSS into the
              // blog editor causes heading rules (h1 { font-size: clamp(...); font-weight:700 })
              // and layout rules to bleed into the editor, making list items appear as giant
              // H1-styled text and breaking the blog content layout. CSS variables are enough
              // to inherit brand colors (--accent, --color-text, etc.) and font families.
              const homeHtml = pages.find(p => p.slug === 'home')?.html ?? ''
              const fontLinks = (homeHtml.match(/<link[^>]*(?:googleapis\.com|gstatic\.com)[^>]*>/gi) ?? []).join('\n')
              const rootVars = (() => {
                const blocks = homeHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []
                for (const block of blocks) {
                  const css = block.replace(/<\/?style[^>]*>/gi, '')
                  const m = css.match(/:root\s*\{([^}]+)\}/)
                  if (m) return `:root{${m[1].trim()}}`
                }
                return ''
              })()
              // Extract scoped DS rules from shared_css (font-family, sizes, colors for .blog-post-content)
              const sharedCssVal = sharedCssRef.current ?? ''
              const DS_START = '/* fact-design-system:start */'
              const DS_END   = '/* fact-design-system:end */'
              const dsStartIdx = sharedCssVal.indexOf(DS_START)
              const dsEndIdx   = sharedCssVal.indexOf(DS_END)
              let dsBlockForEditor = ''
              if (dsStartIdx !== -1 && dsEndIdx !== -1) {
                const dsContent = sharedCssVal.slice(dsStartIdx, dsEndIdx + DS_END.length)
                // Only scoped .blog-post-content rules, no :where() globals that could break editor
                const scopedOnly = dsContent.split('\n').filter(l => !l.trim().startsWith(':where(')).join('\n')
                dsBlockForEditor = `<style>${scopedOnly}</style>`
              }
              const siteStyleBlocks = [fontLinks, rootVars ? `<style>${rootVars}</style>` : ''].join('\n')
              setBlogEditorSiteStyles(siteStyleBlocks)
              // Editor-only overrides: live blog renders inside a grid layout that provides
              // horizontal padding; the editor doesn't, so add it here to keep list markers
              // (bullets/numbers) visible inside the iframe.
              const editorOnlyCss = `body{margin:0!important}.blog-post-wrapper{padding:1.5rem 2rem 3rem!important;max-width:760px!important;margin:0 auto!important}`
              // DS block comes LAST so it wins over BLOG_POST_CONTENT_CSS (same specificity, source order)
              const editorHtml = `<!DOCTYPE html><html lang="${projectContext.language ?? 'it'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${EDITOR_FONTS_INJECT}${siteStyleBlocks}<style>${BLOG_POST_CONTENT_CSS}</style><style>${editorOnlyCss}</style>${dsBlockForEditor}</head><body><div class="blog-post-wrapper"><div class="blog-post-content" contenteditable="true" data-fact-edit="blog-content" style="outline:none">${contentHtml}</div></div></body></html>`
              setBlogEditorSrcDoc(editorHtml)
              blogBaseHtmlRef.current = editorHtml
              // Initialise undo history with the loaded content as the first snapshot
              blogHistoryRef.current = { stack: [contentHtml], index: 0 }
            }

            const createPost = async () => {
              const title = 'Nuovo articolo'
              const slug = `${slugify(title)}-${Date.now().toString().slice(-6)}`
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) return
              const res = await fetch('/api/blog-posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ projectId: id, title, slug, author: userFullName, content_html: '<p>Inizia a scrivere il tuo articolo qui...</p>' }),
              })
              const json = await res.json()
              if (json.post) {
                await loadBlogPosts()
                openPost(json.post)
              }
            }

            const deletePost = async (postId: string) => {
              const ok = await confirmDialog('Eliminare questo articolo? L\'azione è irreversibile.')
              if (!ok) return
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) return
              try {
                const res = await fetch(`/api/blog-posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
                if (!res.ok) {
                  alert(`Errore eliminazione: ${res.status}`)
                  return
                }
                if (selectedPost?.id === postId) setSelectedPost(null)
                await loadBlogPosts()
              } catch (err) {
                console.error('deletePost error:', err)
                alert('Errore di rete durante l\'eliminazione')
              }
            }

            const togglePublish = async (post: BlogPost) => {
              setBlogPublishing(true)
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) { setBlogPublishing(false); return }
              const action = post.status === 'published' ? 'unpublish' : 'publish'
              const res = await fetch(`/api/blog-posts/${post.id}?action=${action}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              })
              const json = await res.json()
              if (json.post) {
                setSelectedPost(prev => prev?.id === post.id ? { ...prev, ...json.post } : prev)
                setBlogPosts(prev => prev.map(p => p.id === post.id ? { ...p, ...json.post } : p))
              }
              setBlogPublishing(false)
            }

            const saveMeta = async (postId: string, updates: Partial<BlogPost>) => {
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) return
              try {
                const res = await fetch(`/api/blog-posts/${postId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify(updates),
                })
                if (!res.ok) {
                  console.error('saveMeta failed:', res.status, await res.text().catch(() => ''))
                  return
                }
                setSelectedPost(prev => prev ? { ...prev, ...updates } : prev)
                setBlogPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updates } : p))
              } catch (err) {
                console.error('saveMeta error:', err)
              }
            }

            const generateWithAI = async () => {
              if (!blogGenTopic.trim()) return
              setBlogGenerating(true)
              setShowBlogGenPrompt(false)

              try {
                const { data: { session } } = await supabase.auth.getSession()
                const token = session?.access_token
                if (!token) { setBlogGenerating(false); return }

                // Create draft post immediately, show editor
                const draftRes = await fetch('/api/blog-posts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    projectId: id,
                    title: `✍️ ${blogGenTopic}`,
                    slug: `generating-${Date.now()}`,
                    content_html: '<p style="color:#999;">⏳ Generazione in corso...</p>',
                    excerpt: '',
                    categories: [],
                    tags: [],
                  }),
                })
                const draftJson = await draftRes.json()
                if (!draftJson.post) {
                  setBlogGenerating(false)
                  return
                }
                const draftId = draftJson.post.id
                setBlogGenDraftId(draftId)
                setBlogGenLiveContent('')
                openPost(draftJson.post)

                // Parse keywords: comma or newline separated, max 5
                const keywords = blogGenKeywords
                  .split(/[,\n]+/)
                  .map(k => k.trim())
                  .filter(Boolean)
                  .slice(0, 5)

                // Stream generation via SSE
                const res = await fetch('/api/generate-blog-post', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ topic: blogGenTopic, keywords, wordCount: blogGenWordCount, paragraphCount: blogGenParaCount, h3Count: blogGenH3Count, h4Count: blogGenH4Count, flags: blogGenFlags, projectId: id, context: projectContext, designSystem }),
                })

                if (!res.ok) {
                  await alertDialog({ title: 'Errore generazione', message: `Timeout (${res.status}). Prova riducendo parole o sezioni.`, variant: 'danger' })
                  setBlogGenerating(false)
                  return
                }

                const reader = res.body?.getReader()
                if (!reader) { setBlogGenerating(false); return }

                const decoder = new TextDecoder()
                let buffer = ''
                let completePost = null
                let accumulatedHtml = ''

                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break

                  buffer += decoder.decode(value, { stream: true })

                  // Process complete SSE events (separated by double newline)
                  const events = buffer.split('\n\n')
                  buffer = events.pop() ?? '' // keep last incomplete chunk

                  for (const event of events) {
                    const lines = event.split('\n')
                    const eventType = lines.find(l => l.startsWith('event:'))?.slice(7).trim()
                    const dataLine = lines.find(l => l.startsWith('data:'))?.slice(5).trim()
                    if (!dataLine) continue

                    try {
                      const data = JSON.parse(dataLine)
                      if (eventType === 'text') {
                        accumulatedHtml += data.text ?? ''
                        // Update live content preview in editor
                        setBlogGenLiveContent(accumulatedHtml)
                      } else if (eventType === 'complete') {
                        completePost = data.post
                      } else if (eventType === 'error') {
                        await alertDialog({ title: 'Errore generazione', message: data.error, variant: 'danger' })
                        setBlogGenerating(false)
                        return
                      }
                    } catch (e) {}
                  }
                }

                // Save complete post
                if (completePost) {
                  // Strip emojis from title just in case the model included them
                  const cleanTitle = (completePost.title ?? '').replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').replace(/\s+/g, ' ').trim()
                  // Auto-derive slug from title if model didn't produce a clean one
                  const autoSlug = (completePost.slug ?? cleanTitle)
                    .toLowerCase()
                    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
                    .replace(/[^a-z0-9\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                  const updateRes = await fetch(`/api/blog-posts/${draftId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      title: cleanTitle,
                      slug: autoSlug,
                      content_html: completePost.content_html,
                      excerpt: completePost.excerpt,
                      seo_title: completePost.seo_title,
                      seo_description: completePost.seo_description,
                    }),
                  })
                  const updateJson = await updateRes.json()
                  if (updateJson.post) {
                    await loadBlogPosts()
                    openPost(updateJson.post)
                  }
                }

                setBlogGenTopic('')
                setBlogGenKeywords('')
              } catch (err) {
                await alertDialog({ title: 'Errore', message: String(err), variant: 'danger' })
              } finally {
                setBlogGenerating(false)
                setBlogGenDraftId(null)
                setBlogGenLiveContent('')
              }
            }

            // ── Blog list view ─────────────────────────────────────────────────
            if (!selectedPost) {
              return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
                  {/* Header */}
                  <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: C.white }}>
                    <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: C.text }}>Blog</h2>
                    <span style={{ fontSize: '0.78rem', color: C.textFaint }}>{blogPosts.length} {blogPosts.length === 1 ? 'articolo' : 'articoli'}</span>
                    {/* Nav toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
                      <button
                        onClick={async () => {
                          const inNav = hasBlogNavLink(pages)
                          const updated = inNav ? removeBlogLinkFromNav(pages) : addBlogLinkToNav(pages, 'Blog')
                          setPages(updated)
                          await saveState(messages, updated)
                        }}
                        title={hasBlogNavLink(pages) ? 'Rimuovi dal menu di navigazione' : 'Aggiungi al menu di navigazione'}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          background: hasBlogNavLink(pages) ? '#dcfce7' : C.bg,
                          color: hasBlogNavLink(pages) ? '#166534' : C.textFaint,
                          border: `1px solid ${hasBlogNavLink(pages) ? '#86efac' : C.border}`,
                          borderRadius: '20px', padding: '3px 10px', fontSize: '0.72rem',
                          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        <span style={{ fontSize: '0.65rem' }}>{hasBlogNavLink(pages) ? '✓' : '+'}</span>
                        Nel menu
                      </button>
                    </div>
                    <div style={{ flex: 1 }} />
                    {blogPosts.length > 0 && (
                      <button
                        title="Rimuovi font-family e altri stili inline ridondanti dagli articoli esistenti (il Design System li applica già globalmente)"
                        onClick={async () => {
                          const ok = await confirmDialog({ title: 'Pulizia stili inline', message: `Rimuovi font-family e stili tipografici inline ridondanti da ${blogPosts.length} articoli?\n\nNon cambia il contenuto, solo l'HTML.`, confirmLabel: 'Pulisci', variant: 'default' })
                          if (!ok) return
                          const { data: { session } } = await supabase.auth.getSession()
                          const token = session?.access_token
                          if (!token) return
                          const res = await fetch('/api/blog-posts/cleanup-styles', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ projectId: id }),
                          })
                          const json = await res.json()
                          await alertDialog({ title: 'Pulizia completata', message: `${json.updated} articoli su ${json.total} aggiornati.`, variant: 'default' })
                        }}
                        style={{ background: 'transparent', color: C.textFaint, border: `1px solid ${C.border}`, padding: '6px 10px', borderRadius: '7px', fontWeight: 500, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
                      >🧹 Pulisci stili</button>
                    )}
                    <button
                      onClick={() => setShowBlogGenPrompt(v => !v)}
                      style={{ background: 'transparent', color: C.blue, border: `1px solid ${C.blue}`, padding: '6px 14px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                    >✦ Genera con AI</button>
                    <button
                      onClick={createPost}
                      style={{ background: C.dark, color: 'white', border: 'none', padding: '6px 14px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                    >+ Nuovo articolo</button>
                  </div>

                  {/* AI generation prompt */}
                  {showBlogGenPrompt && (
                    <div style={{ padding: '12px 24px', borderBottom: `1px solid ${C.border}`, background: '#eff6ff', display: 'flex', flexDirection: 'column' as const, gap: '8px', flexShrink: 0 }}>
                      {/* Row 1: topic */}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.blue, flexShrink: 0, width: '90px' }}>✦ Argomento</span>
                        <input
                          value={blogGenTopic}
                          onChange={e => setBlogGenTopic(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) void generateWithAI() }}
                          placeholder="Es: Software di fatturazione per autónomos in Spagna"
                          autoFocus
                          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '7px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', background: C.white }}
                        />
                      </div>
                      {/* Row 2: keywords + generate */}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.blue, flexShrink: 0, width: '90px' }}>🔑 Keyword</span>
                        <input
                          value={blogGenKeywords}
                          onChange={e => setBlogGenKeywords(e.target.value)}
                          placeholder="Es: fatturazione, Verifactu, autónomo, software contabilità, PYME"
                          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '7px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', background: C.white }}
                        />
                        <button
                          onClick={() => void generateWithAI()}
                          disabled={blogGenerating || !blogGenTopic.trim()}
                          style={{ background: blogGenTopic.trim() && !blogGenerating ? C.blue : '#93c5fd', color: 'white', border: 'none', padding: '7px 18px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: blogGenTopic.trim() && !blogGenerating ? 'pointer' : 'not-allowed', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' as const }}
                        >{blogGenerating ? '⏳ Generazione...' : '✦ Genera'}</button>
                        <button onClick={() => { setShowBlogGenPrompt(false); setBlogGenTopic(''); setBlogGenKeywords('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '1.1rem', flexShrink: 0, lineHeight: 1 }}>✕</button>
                      </div>
                      {/* Row 3: word count + paragraph count */}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.blue, flexShrink: 0, width: '90px' }}>⚙️ Parametri</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.78rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>Parole:</span>
                          <select value={blogGenWordCount} onChange={e => setBlogGenWordCount(Number(e.target.value))}
                            style={{ border: `1px solid ${C.border}`, borderRadius: '7px', padding: '5px 8px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', background: C.white, cursor: 'pointer' }}>
                            {[600, 800, 1000, 1200, 1500, 2000].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.78rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>Sezioni H2:</span>
                          <select value={blogGenParaCount} onChange={e => setBlogGenParaCount(Number(e.target.value))}
                            style={{ border: `1px solid ${C.border}`, borderRadius: '7px', padding: '5px 8px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', background: C.white, cursor: 'pointer' }}>
                            {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.78rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>H3/H2:</span>
                          <select value={blogGenH3Count} onChange={e => setBlogGenH3Count(Number(e.target.value))}
                            style={{ border: `1px solid ${C.border}`, borderRadius: '7px', padding: '5px 8px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', background: C.white, cursor: 'pointer' }}>
                            {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? 'nessuno' : n}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.78rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>H4/H3:</span>
                          <select value={blogGenH4Count} onChange={e => setBlogGenH4Count(Number(e.target.value))}
                            style={{ border: `1px solid ${C.border}`, borderRadius: '7px', padding: '5px 8px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', background: C.white, cursor: 'pointer' }}>
                            {[0, 1, 2].map(n => <option key={n} value={n}>{n === 0 ? 'nessuno' : n}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Row 4: content flags */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.blue, flexShrink: 0, width: '90px' }}>📝 Includi</span>
                        {([
                          { key: 'summary',   label: '📋 Riassunto',      title: 'Box riassunto sotto il titolo' },
                          { key: 'takeaways', label: '💡 Key takeaways',  title: 'Box con 3-5 punti chiave in cima' },
                          { key: 'table',     label: '📊 Tabella',        title: 'Almeno una tabella nel contenuto' },
                          { key: 'faq',       label: '❓ FAQ',             title: 'Sezione domande frequenti (ottima per GEO)' },
                          { key: 'callout',   label: '📌 Callout',        title: 'Box evidenza per concetti importanti' },
                          { key: 'stats',     label: '📈 Dati/Statistiche', title: 'Includi dati numerici e statistiche' },
                          { key: 'cta',       label: '📣 CTA finale',     title: 'Blocco call-to-action alla fine' },
                        ] as { key: keyof typeof blogGenFlags; label: string; title: string }[]).map(({ key, label, title }) => {
                          const active = blogGenFlags[key]
                          return (
                            <button
                              key={key}
                              title={title}
                              onClick={() => setBlogGenFlags(f => ({ ...f, [key]: !f[key] }))}
                              style={{
                                padding: '4px 10px', borderRadius: '20px', border: `1px solid ${active ? C.blue : C.border}`,
                                background: active ? '#eff6ff' : C.white, color: active ? C.blue : C.textFaint,
                                fontSize: '0.75rem', fontWeight: active ? 600 : 400, cursor: 'pointer',
                                fontFamily: 'inherit', transition: 'all 0.15s',
                              }}
                            >{label}</button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Blog header HTML panel */}
                  <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.white }}>
                    <button
                      onClick={() => setBlogHeaderEditorOpen(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 24px', fontSize: '0.82rem', fontWeight: 600, color: C.text, fontFamily: 'inherit' }}
                    >
                      <span>✏️ Sezione personalizzata</span>
                      <span style={{ fontSize: '0.65rem', marginLeft: '2px' }}>{blogHeaderEditorOpen ? '▼' : '▶'}</span>
                    </button>
                    {blogHeaderEditorOpen && (
                      <div style={{ padding: '0 24px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea
                          value={blogHeaderHtml}
                          onChange={e => setBlogHeaderHtml(e.target.value)}
                          style={{ width: '100%', height: '180px', fontFamily: 'monospace', fontSize: '0.8rem', border: `1px solid #e8e4de`, borderRadius: '6px', padding: '8px', resize: 'vertical', background: '#fafaf8', boxSizing: 'border-box' }}
                          placeholder="<section>...</section>"
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            onClick={saveBlogHeader}
                            disabled={blogHeaderSaving === 'saving'}
                            style={{ background: C.blue, color: 'white', border: 'none', padding: '6px 16px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                          >{blogHeaderSaving === 'saving' ? '💾 Salvataggio...' : blogHeaderSaving === 'saved' ? '✓ Salvato' : 'Salva'}</button>
                          <span style={{ fontSize: '0.72rem', color: C.textFaint }}>HTML statico mostrato sopra la griglia articoli</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sidebar banner panel */}
                  <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.white }}>
                    <button
                      onClick={() => setBlogSidebarBannerOpen(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 24px', fontSize: '0.82rem', fontWeight: 600, color: C.text, fontFamily: 'inherit' }}
                    >
                      <span>🖼 Banner laterale articoli</span>
                      <span style={{ fontSize: '0.65rem', marginLeft: '2px' }}>{blogSidebarBannerOpen ? '▼' : '▶'}</span>
                    </button>
                    {blogSidebarBannerOpen && (
                      <div style={{ padding: '0 24px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: C.textMuted }}>URL immagine PNG/JPG</label>
                          <input
                            type="text"
                            value={blogSidebarBannerUrl}
                            onChange={e => setBlogSidebarBannerUrl(e.target.value)}
                            onBlur={e => saveBlogSidebarBanner(e.target.value, blogSidebarBannerLink)}
                            placeholder="https://..."
                            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'inherit', background: '#fafaf8', boxSizing: 'border-box' }}
                          />
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: C.textMuted }}>Link di destinazione</label>
                          <input
                            type="text"
                            value={blogSidebarBannerLink}
                            onChange={e => setBlogSidebarBannerLink(e.target.value)}
                            onBlur={e => saveBlogSidebarBanner(blogSidebarBannerUrl, e.target.value)}
                            placeholder="https://..."
                            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'inherit', background: '#fafaf8', boxSizing: 'border-box' }}
                          />
                        </div>
                        {blogSidebarBannerUrl && (
                          <img src={blogSidebarBannerUrl} alt="Banner preview" style={{ width: '100%', maxWidth: '200px', borderRadius: '8px', border: `1px solid ${C.border}` }} />
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.72rem', color: C.textFaint }}>Appare fisso a destra durante la lettura degli articoli</span>
                          {blogSidebarBannerSaving === 'saving' && <span style={{ fontSize: '0.72rem', color: C.textFaint }}>💾 Salvataggio...</span>}
                          {blogSidebarBannerSaving === 'saved' && <span style={{ fontSize: '0.72rem', color: '#16a34a' }}>✓ Salvato</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Embed & Script injection panel */}
                  {(() => {
                    const SLOT_LABELS: Record<string, { label: string; desc: string }> = {
                      head: { label: '<head>', desc: 'CSS, meta tag, script globali — iniettato in <head> di tutte le pagine' },
                      body_end: { label: '</body>', desc: 'Pixel, chat widget, tag manager — prima di </body> su tutte le pagine' },
                      blog_post_bottom: { label: 'Fondo articoli', desc: 'Dopo ogni articolo del blog (newsletter, CTA, embed)' },
                      blog_list_bottom: { label: 'Fondo lista blog', desc: 'Dopo la griglia articoli nella pagina blog' },
                    }
                    const activeSlots = Object.entries(injectPoints).filter(([, v]) => v && v.trim())
                    return (
                      <div style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.white }}>
                        <button
                          onClick={() => setInjectPointsOpen(v => !v)}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 24px', fontSize: '0.82rem', fontWeight: 600, color: C.text, fontFamily: 'inherit' }}
                        >
                          <span>🔌 Embed & Script</span>
                          {activeSlots.length > 0 && (
                            <span style={{ background: C.blue, color: 'white', borderRadius: '10px', fontSize: '0.65rem', padding: '1px 7px', fontWeight: 700 }}>{activeSlots.length}</span>
                          )}
                          <span style={{ fontSize: '0.65rem', marginLeft: 'auto' }}>{injectPointsOpen ? '▼' : '▶'}</span>
                        </button>
                        {injectPointsOpen && (
                          <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <span style={{ fontSize: '0.72rem', color: C.textFaint, padding: '0 8px' }}>Incolla iframe, script o HTML in punti fissi del sito — senza toccare le pagine. L&apos;agente AI può farlo automaticamente su richiesta.</span>
                            {Object.entries(SLOT_LABELS).map(([slot, { label, desc }]) => {
                              const current = injectPoints[slot] ?? ''
                              return (
                                <div key={slot} style={{ background: '#fafaf8', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{label}</span>
                                    {current && (
                                      <button
                                        onClick={async () => {
                                          const updated = { ...injectPoints }
                                          delete updated[slot]
                                          setInjectPoints(updated)
                                          injectPointsRef.current = updated
                                          await saveInjectPoints(updated)
                                        }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.72rem', fontFamily: 'inherit', padding: '2px 6px' }}
                                      >✕ Rimuovi</button>
                                    )}
                                  </div>
                                  <span style={{ fontSize: '0.68rem', color: C.textFaint }}>{desc}</span>
                                  <textarea
                                    value={current}
                                    onChange={e => {
                                      const updated = { ...injectPoints, [slot]: e.target.value }
                                      if (!e.target.value.trim()) delete updated[slot]
                                      setInjectPoints(updated)
                                      injectPointsRef.current = updated
                                    }}
                                    style={{ width: '100%', height: '80px', fontFamily: 'monospace', fontSize: '0.72rem', border: `1px solid ${C.border}`, borderRadius: '6px', padding: '6px 8px', resize: 'vertical', background: '#fff', boxSizing: 'border-box' }}
                                    placeholder={slot === 'head' ? '<link rel="stylesheet" href="...">' : slot === 'body_end' ? '<script src="..."></script>' : '<iframe src="https://..."></iframe>'}
                                  />
                                </div>
                              )
                            })}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 0 0 4px' }}>
                              <button
                                onClick={() => saveInjectPoints(injectPoints)}
                                disabled={injectPointsSaving === 'saving'}
                                style={{ background: C.blue, color: 'white', border: 'none', padding: '6px 16px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                              >{injectPointsSaving === 'saving' ? '💾 Salvataggio...' : injectPointsSaving === 'saved' ? '✓ Salvato' : 'Salva tutto'}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 100px 120px', gap: '0 8px', padding: '8px 24px', background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                    {['Articolo', 'Stato', 'Data', 'Azioni'].map((h, i) => (
                      <span key={i} style={{ fontSize: '0.67rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                    ))}
                  </div>

                  {/* Post list */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {blogLoading && (
                      <div style={{ padding: '2rem', textAlign: 'center', color: C.textFaint, fontSize: '0.85rem' }}>Caricamento...</div>
                    )}
                    {!blogLoading && blogPosts.length === 0 && (
                      <div style={{ padding: '3rem', textAlign: 'center', color: C.textFaint }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✍️</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.25rem' }}>Nessun articolo ancora</div>
                        <div style={{ fontSize: '0.8rem' }}>Crea il tuo primo post o genera uno con AI</div>
                      </div>
                    )}
                    {blogPosts.map(post => (
                      <div
                        key={post.id}
                        onClick={() => openPost(post)}
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 90px 100px 120px', gap: '0 8px',
                          alignItems: 'center', padding: '12px 16px',
                          background: C.white, border: `1px solid ${C.border}`,
                          borderRadius: '10px', cursor: 'pointer',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.blue; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${C.blue}22` }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
                      >
                        {/* Title + excerpt */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.87rem', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title}</div>
                          {post.excerpt && <div style={{ fontSize: '0.75rem', color: C.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{post.excerpt}</div>}
                        </div>
                        {/* Status badge */}
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', textAlign: 'center',
                          background: post.status === 'published' ? '#dcfce7' : '#f3f4f6',
                          color: post.status === 'published' ? '#166534' : '#6b7280',
                        }}>{post.status === 'published' ? '● Pubblicato' : '○ Bozza'}</span>
                        {/* Date */}
                        <span style={{ fontSize: '0.75rem', color: C.textFaint }}>
                          {post.published_at ? new Date(post.published_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' }) : new Date(post.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </span>
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => togglePublish(post)}
                            disabled={blogPublishing}
                            title={post.status === 'published' ? 'Riporta in bozza' : 'Pubblica'}
                            style={{ background: post.status === 'published' ? '#f3f4f6' : '#dcfce7', color: post.status === 'published' ? '#6b7280' : '#166534', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}
                          >{post.status === 'published' ? '↩ Bozza' : '↑ Pubblica'}</button>
                          <button
                            onClick={() => deletePost(post.id)}
                            title="Elimina"
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem', padding: '4px 6px', borderRadius: '6px' }}
                          >✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }

            // ── Blog post editor view ──────────────────────────────────────────
            const post = selectedPost
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
                {/* Editor header */}
                <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: C.white }}>
                  <button
                    onClick={async () => { await flushBlogSave(); setSelectedPost(null) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '0.85rem', padding: '4px 8px', borderRadius: '6px', fontFamily: 'inherit', fontWeight: 500 }}
                  >← Lista</button>
                  <div style={{ width: '1px', height: '16px', background: C.border }} />
                  <span style={{ fontSize: '0.87rem', fontWeight: 600, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title}</span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                    background: post.status === 'published' ? '#dcfce7' : '#f3f4f6',
                    color: post.status === 'published' ? '#166534' : '#6b7280',
                  }}>{post.status === 'published' ? '● Pubblicato' : '○ Bozza'}</span>
                  {blogSaving === 'saving' && <span style={{ fontSize: '0.72rem', color: C.textFaint }}>💾 Salvataggio...</span>}
                  {blogSaving === 'saved' && <span style={{ fontSize: '0.72rem', color: '#16a34a' }}>✓ Salvato</span>}
                  {blogSaving === 'failed' && <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>⚠ Salvataggio fallito — controlla la console</span>}
                  <a
                    href={`/preview/${projectSlug}/blog/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Preview: /blog/${post.slug}`}
                    style={{ fontSize: '0.72rem', color: C.textFaint, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white }}
                    onClick={async (ev) => {
                      // Flush any pending autosave BEFORE opening preview so the new
                      // tab always sees the latest content (prevents race where preview
                      // opens within the 800ms debounce window showing stale content).
                      ev.preventDefault()
                      const url = `/preview/${projectSlug}/blog/${post.slug}`
                      await flushBlogSave()
                      window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    /blog/{post.slug}
                  </a>
                  <button
                    onClick={() => togglePublish(post)}
                    disabled={blogPublishing}
                    style={{
                      background: post.status === 'published' ? '#f3f4f6' : C.blue,
                      color: post.status === 'published' ? C.text : 'white',
                      border: 'none', padding: '6px 14px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >{blogPublishing ? '⏳...' : post.status === 'published' ? '↩ Bozza' : '↑ Pubblica'}</button>
                </div>

                {/* Editor body: meta panel + iframe */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                  {/* Meta panel */}
                  <div style={{ width: '260px', flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px', background: C.white }}>
                    {(() => {
                      const slugInputRef = { current: null as HTMLInputElement | null }
                      const slugEditedRef = { current: false }
                      return (<>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Titolo</label>
                          <input
                            defaultValue={post.title}
                            onChange={e => {
                              // Real-time suggestion as user types
                              const title = e.target.value.trim()
                              if (title && seoKeywords.length > 0) {
                                const suggested = suggestKeywordsForArticle(title, seoKeywords, undefined, 6)
                                setSuggestedKeywordsForArticle(suggested)
                              }
                            }}
                            onBlur={e => {
                              const newTitle = e.target.value.trim() || post.title
                              saveMeta(post.id, { title: newTitle })
                              // Auto-update slug from title if user hasn't manually edited it
                              if (!slugEditedRef.current && slugInputRef.current) {
                                const newSlug = slugify(newTitle) || post.slug
                                slugInputRef.current.value = newSlug
                                saveMeta(post.id, { slug: newSlug })
                              }
                            }}
                            style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                          />
                          {/* Suggested keywords */}
                          {suggestedKeywordsForArticle.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, marginBottom: '6px' }}>💡 KEYWORD SUGGERITE</div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {suggestedKeywordsForArticle.map(kw => (
                                  <button
                                    key={kw.keyword}
                                    onClick={() => {
                                      const isSelected = articleKeywordChips.includes(kw.keyword)
                                      const newChips = isSelected
                                        ? articleKeywordChips.filter(k => k !== kw.keyword)
                                        : [...articleKeywordChips, kw.keyword]
                                      setArticleKeywordChips(newChips)
                                      saveMeta(post.id, { tags: newChips })
                                    }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '4px 8px',
                                      borderRadius: '5px',
                                      border: `1px solid ${articleKeywordChips.includes(kw.keyword) ? '#6366f1' : C.border}`,
                                      background: articleKeywordChips.includes(kw.keyword) ? '#e0e7ff' : C.white,
                                      color: articleKeywordChips.includes(kw.keyword) ? '#4f46e5' : C.text,
                                      fontSize: '0.72rem',
                                      cursor: 'pointer',
                                      fontFamily: 'inherit',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    {articleKeywordChips.includes(kw.keyword) ? '✓' : '+'} {kw.keyword}
                                    <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({kw.volume})</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Slug URL</label>
                          <input
                            ref={el => { slugInputRef.current = el }}
                            defaultValue={post.slug}
                            onChange={() => { slugEditedRef.current = true }}
                            onBlur={e => {
                              const val = slugify(e.target.value.trim()) || post.slug
                              e.target.value = val
                              saveMeta(post.id, { slug: val })
                            }}
                            style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.75rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const }}
                          />
                        </div>
                      </>)
                    })()}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Estratto</label>
                      <textarea
                        defaultValue={post.excerpt}
                        onBlur={e => saveMeta(post.id, { excerpt: e.target.value.trim() })}
                        rows={3}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'inherit', outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const }}
                      />
                    </div>
                    {/* Featured image */}
                    {(() => {
                      const featImgInputRef = { current: null as HTMLInputElement | null }
                      const handleFeatImg = async (file: File) => {
                        if (!file.type.startsWith('image/')) return
                        const { data: { session } } = await supabase.auth.getSession()
                        if (!session) return
                        const ext = file.name.split('.').pop() || 'png'
                        const path = `${session.user.id}/${id}/feat-${Date.now()}.${ext}`
                        const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
                        if (error) return
                        const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
                        saveMeta(post.id, { featured_image: publicUrl })
                        generateAndSaveImageMeta(path, publicUrl)
                      }
                      return (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Immagine copertina</label>
                          {post.featured_image ? (
                            <div style={{ position: 'relative', marginBottom: '6px' }}>
                              <img src={post.featured_image} alt="" style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '7px', border: `1px solid ${C.border}` }} />
                              <button onClick={() => saveMeta(post.id, { featured_image: null })} style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '0.7rem', cursor: 'pointer' }}>✕</button>
                            </div>
                          ) : null}
                          <button onClick={() => featImgInputRef.current?.click()} style={{ width: '100%', padding: '6px', border: `1px dashed ${C.border}`, borderRadius: '7px', background: 'transparent', color: C.textMuted, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                            {post.featured_image ? '↺ Cambia immagine' : '+ Carica immagine'}
                          </button>
                          <input ref={el => { featImgInputRef.current = el }} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFeatImg(f); e.target.value = '' }} />
                        </div>
                      )
                    })()}

                    {/* Publication date */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Data pubblicazione</label>
                      <input
                        type="date"
                        defaultValue={post.published_at ? post.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10)}
                        onBlur={e => {
                          const val = e.target.value
                          if (val) saveMeta(post.id, { published_at: new Date(val).toISOString() })
                        }}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>

                    {/* Author */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Autore</label>
                      <input
                        defaultValue={post.author || userFullName}
                        onBlur={e => saveMeta(post.id, { author: e.target.value.trim() })}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Categorie</label>
                      <input
                        defaultValue={(post.categories ?? []).join(', ')}
                        placeholder="es: Marketing, SEO"
                        onBlur={e => saveMeta(post.id, { categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Tag</label>
                      <input
                        defaultValue={(post.tags ?? []).join(', ')}
                        placeholder="es: web, design"
                        onBlur={e => saveMeta(post.id, { tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.78rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '10px' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>SEO</div>
                      <label style={{ display: 'block', fontSize: '0.7rem', color: C.textFaint, marginBottom: '4px' }}>Meta title</label>
                      <input
                        defaultValue={post.seo_title ?? ''}
                        placeholder={post.title}
                        onBlur={e => saveMeta(post.id, { seo_title: e.target.value.trim() || null })}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', marginBottom: '8px', boxSizing: 'border-box' as const }}
                      />
                      <label style={{ display: 'block', fontSize: '0.7rem', color: C.textFaint, marginBottom: '4px' }}>Meta description</label>
                      <textarea
                        defaultValue={post.seo_description ?? ''}
                        placeholder="Descrizione per i motori di ricerca..."
                        onBlur={e => saveMeta(post.id, { seo_description: e.target.value.trim() || null })}
                        rows={3}
                        style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const }}
                      />
                    </div>
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '10px' }}>
                      <button
                        onClick={() => deletePost(post.id)}
                        style={{ width: '100%', background: 'none', border: `1px solid #fca5a5`, color: '#ef4444', borderRadius: '7px', padding: '7px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
                      >✕ Elimina articolo</button>
                    </div>
                  </div>

                  {/* Content editor iframe */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 14px', borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.72rem', color: C.textFaint, fontWeight: 600 }}>CONTENUTO ARTICOLO</span>
                      <span style={{ fontSize: '0.68rem', color: C.textFaint }}>— clicca sul testo per modificarlo</span>
                    </div>
                    {/* ── Formatting toolbar ── */}
                    {(() => {
                      const blogImgInputRef = { current: null as HTMLInputElement | null }
                      const win = () => blogIframeRef.current?.contentWindow
                      const fmt = (cmd: string, val?: string) => win()?.postMessage({ type: 'fact-format', cmd, val }, '*')
                      const handleBlogImageUpload = async (file: File) => {
                        if (!file.type.startsWith('image/')) return
                        const { data: { session } } = await supabase.auth.getSession()
                        if (!session) return
                        const ext = file.name.split('.').pop() || 'png'
                        const path = `${session.user.id}/${id}/blog-${Date.now()}.${ext}`
                        const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
                        if (error) return
                        const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
                        const imgHtml = buildImageHtml(publicUrl)
                        win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: imgHtml }, '*')
                        generateAndSaveImageMeta(path, publicUrl)
                      }

                      // Shared dropdown menu styles
                      const dropMenu: React.CSSProperties = {
                        position: 'absolute', top: '100%', left: 0, zIndex: 9999,
                        background: '#fff', border: `1px solid ${C.border}`,
                        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        padding: '4px', minWidth: '180px', marginTop: '3px',
                      }
                      const dropItem = (onClick: () => void, label: React.ReactNode, active = false): React.CSSProperties => ({})
                      void dropItem // used inline below

                      const blockLabel: Record<string, string> = { H1: 'H1', H2: 'H2', H3: 'H3', H4: 'H4', P: '§ P' }
                      const currentBlock = blogActiveBlock && blockLabel[blogActiveBlock] ? blockLabel[blogActiveBlock] : '§ P'

                      return (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderBottom: `1px solid ${C.border}`, background: C.white, flexShrink: 0, flexWrap: 'wrap', minHeight: '42px' }}
                          // Close all dropdowns when clicking anywhere on the toolbar
                          onClick={() => { setBlogListOpen(false); setBlogInsertOpen(false); setBlogAlignOpen(false) }}
                        >
                          {/* ── Undo / Redo (custom snapshot-based, more reliable than execCommand) ── */}
                          <button title="Annulla" onMouseDown={e => { e.preventDefault(); blogUndo() }}
                            style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
                          </button>
                          <button title="Ripristina" onMouseDown={e => { e.preventDefault(); blogRedo() }}
                            style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>
                          </button>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Font picker ───────────────────────────────── */}
                          <select
                            title="Scegli font"
                            value={blogFontName}
                            onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                            onChange={e => {
                              const font = e.target.value
                              if (!font) return
                              win()?.postMessage({ type: 'fact-format', cmd: 'fontName', val: font }, '*')
                            }}
                            style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'inherit', maxWidth: '110px' }}
                          >
                            <option value="">Font</option>
                            <optgroup label="Sistema">
                              <option value="Georgia">Georgia</option>
                              <option value="Times New Roman">Times New Roman</option>
                              <option value="Arial">Arial</option>
                              <option value="Helvetica">Helvetica</option>
                              <option value="Verdana">Verdana</option>
                              <option value="Trebuchet MS">Trebuchet MS</option>
                              <option value="Courier New">Courier New</option>
                            </optgroup>
                            <optgroup label="Google Fonts">
                              <option value="Inter">Inter</option>
                              <option value="Space Grotesk">Space Grotesk</option>
                              <option value="Lato">Lato</option>
                              <option value="Roboto">Roboto</option>
                              <option value="Open Sans">Open Sans</option>
                              <option value="Montserrat">Montserrat</option>
                              <option value="Merriweather">Merriweather</option>
                              <option value="Playfair Display">Playfair Display</option>
                              <option value="Source Serif 4">Source Serif 4</option>
                            </optgroup>
                          </select>

                          {/* ── Font size picker (pt) ─────────────────────── */}
                          <select
                            title="Dimensione testo"
                            value={blogFontSizePt ?? ''}
                            onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                            onChange={e => {
                              const pt = e.target.value
                              if (!pt) return
                              win()?.postMessage({ type: 'fact-fontsize', pt: Number(pt) }, '*')
                            }}
                            style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'inherit', width: '68px' }}
                          >
                            <option value="">pt</option>
                            {[9,10,11,12,13,14,15,16,18,20,24,28,30,36,48,60].map(pt => (
                              <option key={pt} value={pt}>{pt} pt</option>
                            ))}
                          </select>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Color picker ──────────────────────────────── */}
                          <label title="Colore testo" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, height: '26px', gap: '1px', position: 'relative', userSelect: 'none' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: C.text, lineHeight: 1, pointerEvents: 'none' }}>A</span>
                            <div style={{ width: '14px', height: '3px', borderRadius: '1px', background: 'linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7)', pointerEvents: 'none' }} />
                            <input type="color" defaultValue="#000000"
                              ref={el => { blogColorInputRef.current = el }}
                              onMouseDown={() => win()?.postMessage({ type: 'fact-save-sel' }, '*')}
                              onChange={e => win()?.postMessage({ type: 'fact-format', cmd: 'foreColor', val: e.target.value }, '*')}
                              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none', padding: 0 }}
                            />
                          </label>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Block type dropdown ───────────────────────── */}
                          <div style={{ position: 'relative' }}>
                            <button
                              title="Tipo di blocco"
                              onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
                              onClick={e => { e.stopPropagation(); setBlogListOpen(false); setBlogInsertOpen(false); setBlogAlignOpen(false) }}
                            >
                              {/* Use native select for block type — it shows current value and is accessible */}
                            </button>
                            <select
                              title="Tipo di blocco"
                              value={blogActiveBlock || 'P'}
                              onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                              onChange={e => {
                                fmt('formatBlock', e.target.value.toLowerCase())
                                setBlogListOpen(false); setBlogInsertOpen(false); setBlogAlignOpen(false)
                              }}
                              style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'monospace', fontWeight: 700, minWidth: '80px' }}
                            >
                              <option value="LI" hidden>• Elemento lista</option>
                              <option value="H1">H1 — Titolo 1</option>
                              <option value="H2">H2 — Titolo 2</option>
                              <option value="H3">H3 — Titolo 3</option>
                              <option value="H4">H4 — Titolo 4</option>
                              <option value="P">§ — Paragrafo</option>
                              <option value="BLOCKQUOTE">❝ — Citazione</option>
                              <option value="PRE">{'<>'} — Codice</option>
                            </select>
                          </div>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Line height ───────────────────────────────── */}
                          <select
                            title="Interlinea"
                            value={blogLineHeight || ''}
                            onMouseDown={e => { e.stopPropagation(); win()?.postMessage({ type: 'fact-save-sel' }, '*') }}
                            onChange={e => {
                              const val = e.target.value
                              if (!val) return
                              win()?.postMessage({ type: 'fact-lineheight', val }, '*')
                            }}
                            style={{ height: '26px', padding: '0 4px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', fontSize: '0.75rem', color: C.text, fontFamily: 'inherit', minWidth: '64px' }}
                          >
                            <option value="">↕ Interlinea</option>
                            <option value="1">× 1</option>
                            <option value="1.2">× 1.2</option>
                            <option value="1.4">× 1.4</option>
                            <option value="1.5">× 1.5</option>
                            <option value="1.6">× 1.6</option>
                            <option value="1.8">× 1.8</option>
                            <option value="2">× 2</option>
                            <option value="2.5">× 2.5</option>
                            <option value="3">× 3</option>
                          </select>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Bold / Italic / Underline / Strike ────────── */}
                          {([
                            { label: 'B', cmd: 'bold', title: 'Grassetto (Ctrl+B)', s: { fontWeight: 800 } },
                            { label: 'I', cmd: 'italic', title: 'Corsivo (Ctrl+I)', s: { fontStyle: 'italic' as const } },
                            { label: 'U', cmd: 'underline', title: 'Sottolineato (Ctrl+U)', s: { textDecoration: 'underline' } },
                            { label: 'S', cmd: 'strikeThrough', title: 'Barrato', s: { textDecoration: 'line-through' } },
                          ]).map(b => (
                            <button key={b.cmd} title={b.title}
                              onMouseDown={e => { e.preventDefault(); fmt(b.cmd) }}
                              style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, fontSize: '0.82rem', lineHeight: 1.4, ...b.s }}
                            >{b.label}</button>
                          ))}

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Alignment dropdown ────────────────────────── */}
                          <div style={{ position: 'relative' }}>
                            <button
                              title="Allineamento testo"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); setBlogAlignOpen(v => !v); setBlogListOpen(false); setBlogInsertOpen(false) }}
                              style={{ padding: '2px 7px', border: `1px solid ${blogAlignOpen ? C.blue : C.border}`, borderRadius: 4, background: blogAlignOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: blogAlignOpen ? C.blue : C.text, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '3px', height: '26px' }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                              <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                            </button>
                            {blogAlignOpen && (
                              <div style={dropMenu} onClick={e => e.stopPropagation()}>
                                {([
                                  { label: '⬅  Sinistra', cmd: 'justifyLeft' },
                                  { label: '↔  Centro', cmd: 'justifyCenter' },
                                  { label: '➡  Destra', cmd: 'justifyRight' },
                                  { label: '⬛  Giustificato', cmd: 'justifyFull' },
                                ]).map(a => (
                                  <button key={a.cmd}
                                    onMouseDown={e => { e.preventDefault(); fmt(a.cmd); setBlogAlignOpen(false) }}
                                    style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                  >{a.label}</button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Link ─────────────────────────────────────── */}
                          <button title="Inserisci / modifica link"
                            onMouseDown={e => { e.preventDefault(); win()?.postMessage({ type: 'fact-link' }, '*') }}
                            style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, display: 'flex', alignItems: 'center', height: '26px' }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          </button>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Liste dropdown ───────────────────────────── */}
                          <div style={{ position: 'relative' }}>
                            <button
                              title="Liste"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); setBlogListOpen(v => !v); setBlogInsertOpen(false); setBlogAlignOpen(false) }}
                              style={{ padding: '2px 7px', border: `1px solid ${blogListOpen ? C.blue : C.border}`, borderRadius: 4, background: blogListOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: blogListOpen ? C.blue : C.text, display: 'flex', alignItems: 'center', gap: '3px', height: '26px' }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                              <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                            </button>
                            {blogListOpen && (
                              <div style={dropMenu} onClick={e => e.stopPropagation()}>
                                <button onMouseDown={e => { e.preventDefault(); fmt('insertUnorderedList'); setBlogListOpen(false) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
                                  Elenco puntato
                                </button>
                                <button onMouseDown={e => { e.preventDefault(); fmt('insertOrderedList'); setBlogListOpen(false) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4M3 10h2" strokeWidth="1.5"/><path d="M3 16a1.5 1.5 0 0 1 3 0c0 1.5-3 3-3 3h3" strokeWidth="1.5"/></svg>
                                  Elenco numerato
                                </button>
                                <div style={{ height: 1, background: C.border, margin: '3px 0' }} />
                                <button onMouseDown={e => { e.preventDefault(); fmt('indent'); setBlogListOpen(false) }}
                                  style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >→  Aumenta rientro</button>
                                <button onMouseDown={e => { e.preventDefault(); fmt('outdent'); setBlogListOpen(false) }}
                                  style={{ display: 'block', width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.8rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >←  Diminuisci rientro</button>
                              </div>
                            )}
                          </div>

                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />

                          {/* ── Inserisci dropdown ───────────────────────── */}
                          <div style={{ position: 'relative' }}>
                            <button
                              title="Inserisci elemento"
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => { e.stopPropagation(); setBlogInsertOpen(v => !v); setBlogListOpen(false); setBlogAlignOpen(false) }}
                              style={{ padding: '2px 8px', border: `1px solid ${blogInsertOpen ? C.blue : C.border}`, borderRadius: 4, background: blogInsertOpen ? '#eff6ff' : C.white, cursor: 'pointer', color: blogInsertOpen ? C.blue : C.text, fontSize: '0.72rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', height: '26px', whiteSpace: 'nowrap' }}
                            >
                              + Inserisci <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
                            </button>
                            {blogInsertOpen && (
                              <div style={{ ...dropMenu, minWidth: '200px' }} onClick={e => e.stopPropagation()}>
                                {/* Table — grid picker */}
                                {(() => {
                                  const MAX_C = 6, MAX_R = 6
                                  const buildTable = (cols: number, rows: number) => {
                                    const thCells = Array.from({length:cols},(_,i)=>`<th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna ${i+1}</th>`).join('')
                                    const tbody = Array.from({length:rows},(_,r)=>{
                                      const bg = r%2===1?';background:#f9fafb':''
                                      const tds = Array.from({length:cols},(_,c)=>`<td style="border:1px solid #d1d5db;padding:8px 12px${bg}">Dato ${r*cols+c+1}</td>`).join('')
                                      return `<tr>${tds}</tr>`
                                    }).join('')
                                    return `<table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.95rem"><thead><tr>${thCells}</tr></thead><tbody>${tbody}</tbody></table>`
                                  }
                                  return (
                                    <div style={{ padding: '6px 12px 8px' }}>
                                      <div style={{ fontSize: '0.75rem', color: C.textMuted, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>
                                        Tabella {blogTableHov[0]>0?`${blogTableHov[0]}×${blogTableHov[1]}`:'— scegli dimensione'}
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${MAX_C},18px)`, gap: 2 }}>
                                        {Array.from({length:MAX_R},(_,r)=>Array.from({length:MAX_C},(_,c)=>(
                                          <div key={`${r}-${c}`}
                                            onMouseEnter={() => setBlogTableHov([c+1,r+1])}
                                            onMouseLeave={() => setBlogTableHov([0,0])}
                                            onMouseDown={ev => {
                                              ev.preventDefault()
                                              if(c+1>0&&r+1>0){
                                                win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: buildTable(c+1,r+1) }, '*')
                                                setBlogInsertOpen(false)
                                              }
                                            }}
                                            style={{ width:18,height:18,borderRadius:2,border:`1px solid ${(c+1<=blogTableHov[0]&&r+1<=blogTableHov[1])?C.blue:C.border}`,background:(c+1<=blogTableHov[0]&&r+1<=blogTableHov[1])?'#eff6ff':'transparent',cursor:'pointer',boxSizing:'border-box' }}
                                          />
                                        )))}
                                      </div>
                                      <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: '6px' }}>Usa tasto destro dentro la tabella per aggiungere/rimuovere righe e colonne</div>
                                    </div>
                                  )
                                })()}
                                {/* Image */}
                                <button onClick={() => { setBlogInsertOpen(false); setMediaPickerTarget('blog') }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                  Immagine
                                </button>
                                <div style={{ height: 1, background: C.border, margin: '3px 0' }} />
                                {/* Divider */}
                                <button onMouseDown={e => {
                                  e.preventDefault()
                                  win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: '<hr style="border:none;border-top:2px solid #e5e7eb;margin:2rem 0;">' }, '*')
                                  setBlogInsertOpen(false)
                                }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >
                                  <span style={{ fontSize: '1rem' }}>—</span>
                                  Separatore (HR)
                                </button>
                                {/* Code block */}
                                <button onMouseDown={e => {
                                  e.preventDefault()
                                  win()?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: '<pre style="background:#1e293b;color:#e2e8f0;padding:1rem 1.25rem;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:0.88rem;margin:1.5rem 0;"><code>// il tuo codice qui</code></pre>' }, '*')
                                  setBlogInsertOpen(false)
                                }}
                                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: C.text, fontSize: '0.82rem', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit' }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                >
                                  <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{'{}'}</span>
                                  Blocco codice
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Hidden image input */}
                          <input
                            id="blog-img-file-input"
                            ref={el => { blogImgInputRef.current = el }}
                            type="file" accept="image/*" style={{ display: 'none' }}
                            onChange={e => { const file = e.target.files?.[0]; if (file) handleBlogImageUpload(file); e.target.value = '' }}
                          />
                        </div>
                      )
                    })()}
                    {blogGenerating && selectedPost?.id === blogGenDraftId ? (
                      <div style={{ flex: 1, overflowY: 'auto', background: 'white', width: '100%' }}>
                        {/* inject site fonts + css vars so the live preview matches the actual blog */}
                        {blogEditorSiteStyles
                          ? <div dangerouslySetInnerHTML={{ __html: blogEditorSiteStyles }} />
                          : <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" />
                        }
                        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                        <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 48px', boxSizing: 'border-box' as const }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', color: '#6b7280', fontSize: '0.85rem' }}>
                            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                            <span>Generazione in corso…</span>
                          </div>
                          <div
                            style={{ fontFamily: 'var(--font-body, "Space Grotesk", sans-serif)', lineHeight: 1.8, color: '#1a1a1a', fontSize: '1rem' }}
                            dangerouslySetInnerHTML={{ __html: blogGenLiveContent || '<p style="color:#ccc">In attesa del contenuto…</p>' }}
                          />
                        </div>
                      </div>
                    ) : blogEditorSrcDoc ? (
                      <iframe
                        ref={blogIframeRef}
                        srcDoc={blogEditorSrcDoc + `<script id="fact-edit-script">${INLINE_EDIT_SCRIPT}</script>`}
                        style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
                        title="Blog Editor"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })()
        ) : viewMode === 'design' ? (
          /* ── Design System ─────────────────────────────────────────────────── */
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', background: C.bg }}>
            <div style={{ maxWidth: '880px', margin: '0 auto' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: C.text }}>Design System — Tipografia</h2>
                  <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: C.textMuted }}>Font, dimensioni e colori vengono iniettati in tutte le pagine del progetto.</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {designSaving === 'saving' && <span style={{ fontSize: '0.75rem', color: C.textMuted }}>Salvataggio…</span>}
                  {designSaving === 'saved'  && <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>✓ Applicato a tutte le pagine</span>}
                  <button
                    onClick={() => setDesignSystem(DEFAULT_DESIGN_SYSTEM)}
                    style={{ padding: '6px 12px', border: `1px solid ${C.border}`, borderRadius: 7, background: C.white, cursor: 'pointer', fontSize: '0.78rem', color: C.textMuted, fontFamily: 'inherit' }}
                  >Ripristina default</button>
                  <button
                    onClick={() => saveDesignSystem(designSystem)}
                    style={{ padding: '6px 16px', border: 'none', borderRadius: 7, background: C.blue, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit' }}
                  >⚡ Applica a tutte le pagine</button>
                </div>
              </div>

              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 76px 100px 110px 70px 90px', gap: '6px', padding: '6px 14px', marginBottom: '2px' }}>
                {['Elemento', 'Font', 'Dimens.', 'Peso', 'Colore', 'Line-H', 'Spaziatura'].map(h => (
                  <span key={h} style={{ fontSize: '0.64rem', color: C.textFaint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                ))}
              </div>

              {/* Rows */}
              {(['h1','h2','h3','h4','h5','h6','p','li','a'] as const).map(tag => {
                const cfg = designSystem[tag]
                const update = (key: keyof TypoConfig, val: string) =>
                  setDesignSystem(prev => ({ ...prev, [tag]: { ...prev[tag], [key]: val } }))
                const labelMap: Record<string, string> = {
                  h1: 'H1 — Titolo principale', h2: 'H2 — Secondario', h3: 'H3 — Terziario',
                  h4: 'H4', h5: 'H5', h6: 'H6', p: 'P — Paragrafo', li: 'LI — Elenco puntato', a: 'A — Link',
                }
                const previewText: Record<string, string> = {
                  h1: 'Titolo principale', h2: 'Titolo secondario', h3: 'Titolo terziario',
                  h4: 'Titolo 4', h5: 'Titolo 5', h6: 'Titolo 6',
                  p: 'Testo del paragrafo: questo è un esempio di corpo del testo con le impostazioni scelte.',
                  li: '• Elemento elenco puntato — stessa dimensione del paragrafo',
                  a: 'Questo è un link di esempio',
                }
                const controlStyle: React.CSSProperties = { height: '28px', padding: '0 6px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', background: C.white, color: C.text, width: '100%' }
                return (
                  <div key={tag} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: '10px', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 76px 100px 110px 70px 90px', gap: '6px', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontWeight: 700, fontSize: '0.76rem', color: C.text }}>{labelMap[tag]}</span>
                      {/* Font */}
                      <select value={cfg.fontFamily} onChange={e => update('fontFamily', e.target.value)} style={controlStyle}>
                        <option value="inherit">Eredita</option>
                        <optgroup label="Sistema">
                          <option>Georgia</option><option>Arial</option><option>Helvetica</option><option>Verdana</option><option>Trebuchet MS</option><option>Courier New</option>
                        </optgroup>
                        <optgroup label="Google Fonts">
                          <option>Inter</option><option>Space Grotesk</option><option>Lato</option><option>Roboto</option><option>Open Sans</option><option>Montserrat</option><option>Merriweather</option><option>Playfair Display</option><option>Source Serif 4</option>
                        </optgroup>
                      </select>
                      {/* Size (pt) */}
                      {(() => {
                        const ptOptions = [9,10,11,12,13,14,15,16,18,20,24,28,30,36,48,60,72]
                        // Normalize stored value to pt number for select matching
                        const toPtNum = (v: string): number => {
                          if (!v || v === 'inherit') return 0
                          const ptM = v.match(/^(\d+(?:\.\d+)?)pt$/)
                          if (ptM) return Math.round(Number(ptM[1]))
                          const remM = v.match(/^(\d+(?:\.\d+)?)rem$/)
                          if (remM) return Math.round(Number(remM[1]) * 12)
                          const pxM = v.match(/^(\d+(?:\.\d+)?)px$/)
                          if (pxM) return Math.round(Number(pxM[1]) * 0.75)
                          return 0
                        }
                        const currentPt = toPtNum(cfg.fontSize)
                        return (
                          <select
                            value={currentPt || ''}
                            onChange={e => update('fontSize', e.target.value ? `${e.target.value}pt` : 'inherit')}
                            title="Dimensione (pt)"
                            style={controlStyle}
                          >
                            <option value="">—</option>
                            {ptOptions.map(pt => (
                              <option key={pt} value={pt}>{pt} pt</option>
                            ))}
                          </select>
                        )
                      })()}
                      {/* Weight */}
                      <select value={cfg.fontWeight} onChange={e => update('fontWeight', e.target.value)} style={controlStyle}>
                        <option value="300">300 Light</option><option value="400">400 Regular</option><option value="500">500 Medium</option><option value="600">600 SemiBold</option><option value="700">700 Bold</option><option value="800">800 ExtraBold</option><option value="900">900 Black</option>
                      </select>
                      {/* Color */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input type="color" value={cfg.color.startsWith('#') ? cfg.color : '#374151'} onChange={e => update('color', e.target.value)} style={{ width: '26px', height: '26px', border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px', cursor: 'pointer', flexShrink: 0 }} />
                        <input value={cfg.color} onChange={e => update('color', e.target.value)} placeholder="#000" style={{ ...controlStyle, width: '68px', fontFamily: 'monospace', fontSize: '0.7rem' }} />
                      </div>
                      {/* Line height */}
                      <input value={cfg.lineHeight} onChange={e => update('lineHeight', e.target.value)} placeholder="1.5" title="Line height" style={controlStyle} />
                      {/* Letter spacing */}
                      <input value={cfg.letterSpacing} onChange={e => update('letterSpacing', e.target.value)} placeholder="0" title="Letter spacing" style={controlStyle} />
                    </div>
                    {/* Preview */}
                    <div style={{ padding: '8px 14px 10px', background: '#fafaf9' }}>
                      {tag === 'a' ? (
                        <a href="#" onClick={e => e.preventDefault()} style={{
                          fontFamily: cfg.fontFamily === 'inherit' ? undefined : `'${cfg.fontFamily}',sans-serif`,
                          fontSize: cfg.fontSize === 'inherit' ? undefined : cfg.fontSize,
                          fontWeight: cfg.fontWeight as React.CSSProperties['fontWeight'],
                          color: cfg.color,
                          lineHeight: cfg.lineHeight === 'inherit' ? undefined : cfg.lineHeight,
                          letterSpacing: (cfg.letterSpacing === '0' || cfg.letterSpacing === 'inherit') ? undefined : cfg.letterSpacing,
                        }}>{previewText[tag]}</a>
                      ) : React.createElement(tag, {
                        style: {
                          margin: 0, padding: 0,
                          fontFamily: cfg.fontFamily === 'inherit' ? undefined : `'${cfg.fontFamily}',sans-serif`,
                          fontSize: cfg.fontSize === 'inherit' ? undefined : cfg.fontSize,
                          fontWeight: cfg.fontWeight,
                          color: cfg.color,
                          lineHeight: cfg.lineHeight === 'inherit' ? undefined : cfg.lineHeight,
                          letterSpacing: (cfg.letterSpacing === '0' || cfg.letterSpacing === 'inherit') ? undefined : cfg.letterSpacing,
                        }
                      }, previewText[tag])}
                    </div>
                  </div>
                )
              })}

              {/* ── Bullet config row ── */}
              {(() => {
                const b = designSystem.bullet ?? DEFAULT_DESIGN_SYSTEM.bullet
                const SYMBOLS = [
                  { v: '•', label: '• Bullet' }, { v: '·', label: '· Middle dot' },
                  { v: '›', label: '› Angle' }, { v: '»', label: '» Double angle' },
                  { v: '→', label: '→ Arrow' }, { v: '–', label: '– Dash' },
                  { v: '◦', label: '◦ Circle' }, { v: '▸', label: '▸ Triangle' },
                  { v: '✓', label: '✓ Check' }, { v: '★', label: '★ Star' },
                ]
                const SIZES = [
                  { v: '0.45em', label: 'XS' }, { v: '0.55em', label: 'S' },
                  { v: '0.65em', label: 'M' }, { v: '0.75em', label: 'L' },
                  { v: '0.9em', label: 'XL' }, { v: '1em', label: 'XXL' },
                ]
                const controlStyle: React.CSSProperties = { height: '28px', padding: '0 6px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', background: C.white, color: C.text }
                return (
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: '10px', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 1fr', gap: '6px', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontWeight: 700, fontSize: '0.76rem', color: C.text }}>UL — Pallini</span>
                      <select value={b.symbol} onChange={e => setDesignSystem(prev => ({ ...prev, bullet: { ...prev.bullet, symbol: e.target.value } }))} style={controlStyle}>
                        {SYMBOLS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                      </select>
                      <span style={{ fontSize: '0.72rem', color: C.textFaint, paddingLeft: '6px' }}>Dimensione</span>
                      <select value={b.size} onChange={e => setDesignSystem(prev => ({ ...prev, bullet: { ...prev.bullet, size: e.target.value } }))} style={controlStyle}>
                        {SIZES.map(s => <option key={s.v} value={s.v}>{s.label} ({s.v})</option>)}
                      </select>
                    </div>
                    <div style={{ padding: '8px 14px 10px', background: '#fafaf9' }}>
                      <ul style={{ margin: 0, padding: '0 0 0 1.5rem', listStyle: 'none' }}>
                        {['Primo elemento di esempio', 'Secondo elemento'].map((t, i) => (
                          <li key={i} style={{ position: 'relative', paddingLeft: '0.05em', fontSize: (designSystem.li?.fontSize !== 'inherit' ? designSystem.li?.fontSize : undefined), color: designSystem.li?.color, lineHeight: designSystem.li?.lineHeight !== 'inherit' ? designSystem.li?.lineHeight : undefined, marginBottom: '4px' }}>
                            <span style={{ position: 'absolute', left: '-1.1em', top: '50%', transform: 'translateY(-50%)', fontSize: b.size, lineHeight: 1 }}>{b.symbol}</span>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              })()}

            </div>
          </div>
        ) : viewMode === 'pages' ? (
          /* ── Page Manager (tree list) ──────────────────────────────────────── */
          (() => {
            const handleDrop = async (dropIdx: number) => {
              const fromIdx = dragIndexRef.current
              dragIndexRef.current = null
              setDragOverIndex(null)
              if (fromIdx === null || fromIdx === dropIdx) return
              const next = [...pages]
              const [moved] = next.splice(fromIdx, 1)
              next.splice(dropIdx, 0, moved)
              const synced = reorderNavLinks(next)
              setPages(synced)
              await saveState(messages, synced)
            }
            const updatePageField = async (slug: string, field: 'name' | 'menuLabel' | 'inMenu' | 'og_title', value: string | boolean) => {
              const next = pages.map(p => p.slug === slug ? { ...p, [field]: value } : p)
              const synced = (field === 'inMenu' || field === 'menuLabel') ? reorderNavLinks(next) : next
              setPages(synced)
              await saveState(messages, synced)
            }

            // Update a per-page robots directive (noindex / nofollow). Applied authoritatively
            // at serve time — see prepareHtml in lib/preview.ts. Republish to push live.
            const updatePageRobots = async (slug: string, key: 'noindex' | 'nofollow', value: boolean) => {
              const next = pages.map(p => p.slug === slug
                ? { ...p, robots: { ...(p as Page).robots, [key]: value } }
                : p)
              setPages(next)
              await saveState(messages, next)
            }

            const renamePageSlug = async (oldSlug: string, rawValue: string) => {
              // Sanitize: lowercase, spaces→hyphens, strip anything that's not a-z 0-9 - _ /
              const newSlug = rawValue.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, '')
              if (!newSlug || newSlug === oldSlug) { setRenamingSlug(null); return }
              if (pages.some(p => p.slug === newSlug)) {
                await alertDialog({ title: 'URL già in uso', message: `Esiste già una pagina con slug "${newSlug}". Scegli un URL diverso.`, variant: 'danger' })
                return
              }
              // Escape oldSlug for use in regex
              const escaped = oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const linkRe = new RegExp(`href="\\./` + escaped + `(["/?#])`, 'g')
              const next = pages.map(p => {
                // Update the slug on the matching page; update nav links on all pages
                const slug = p.slug === oldSlug ? newSlug : p.slug
                const html = p.html.replace(linkRe, `href="./${newSlug}$1`)
                return { ...p, slug, html }
              })
              setPages(next)
              if (activeSlug === oldSlug) setActiveSlug(newSlug)
              setRenamingSlug(null)
              await saveState(messages, next)
            }
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.bg }}>
                {/* Header */}
                <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, background: C.white }}>
                  <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: C.text }}>Pagine & Menu</h2>
                  <span style={{ fontSize: '0.78rem', color: C.textFaint }}>{pages.length} {pages.length === 1 ? 'pagina' : 'pagine'}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => {
                      setInput('Aggiungi una nuova pagina al sito')
                      setViewMode('preview')
                      setChatHidden(false)
                      setTimeout(() => textareaRef.current?.focus(), 100)
                    }}
                    style={{ background: C.dark, color: 'white', border: 'none', padding: '6px 14px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                  >+ Nuova pagina</button>
                </div>

                {/* Column labels */}
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 60px 80px 90px', gap: '0 8px', padding: '8px 20px', background: C.bg, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                  {['', 'Pagina', 'Slug / URL', 'OG img', 'Menu', 'Azioni'].map((h, i) => (
                    <span key={i} style={{ fontSize: '0.67rem', fontWeight: 700, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                  ))}
                </div>

                {/* Tree rows */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {pages.map((page, idx) => {
                    const isExpanded = renamingSlug === page.slug
                    const inMenu = page.inMenu !== false
                    const isDragOver = dragOverIndex === idx
                    return (
                      <div
                        key={page.slug}
                        onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx) }}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null) }}
                        style={{
                          background: C.white,
                          border: `1px solid ${isDragOver ? C.blue : C.border}`,
                          borderRadius: '10px',
                          boxShadow: isDragOver ? `0 0 0 2px ${C.blue}22` : 'none',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                          opacity: dragIndexRef.current === idx ? 0.5 : 1,
                        }}
                      >
                        {/* Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 60px 80px 90px', gap: '0 8px', alignItems: 'center', padding: '10px 12px' }}>
                          {/* Drag handle — only active when row is collapsed */}
                          <div
                            draggable={!isExpanded}
                            onDragStart={!isExpanded ? (e) => {
                              e.stopPropagation()
                              dragIndexRef.current = idx
                            } : undefined}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: isExpanded ? 'default' : 'grab',
                              color: isExpanded ? C.border : C.textFaint,
                              fontSize: '1rem', userSelect: 'none',
                            }}
                          >
                            ⠿
                          </div>

                          {/* Name — click to open/close the settings panel */}
                          <div
                            onClick={() => { setRenamingSlug(isExpanded ? null : page.slug); setRenameValue(page.name); setEditSlugValue(page.slug); setMenuLabelValue(page.menuLabel ?? '') }}
                            title="Apri impostazioni pagina"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, cursor: 'pointer' }}
                          >
                            <span style={{ fontSize: '0.7rem', color: isExpanded ? C.blue : C.textFaint, transition: 'transform .15s', transform: isExpanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>▶</span>
                            <span style={{ fontSize: '0.8rem' }}>📄</span>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: isExpanded ? C.blue : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.name}</span>
                            {page.slug === 'home' && <span style={{ fontSize: '0.62rem', background: C.blue, color: 'white', padding: '1px 6px', borderRadius: '10px', fontWeight: 700, flexShrink: 0 }}>HOME</span>}
                          </div>

                          {/* Slug */}
                          <span style={{ fontSize: '0.72rem', color: C.textFaint, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            /{page.slug === 'home' ? '' : page.slug}
                          </span>

                          {/* OG Image picker */}
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            {(page as any).og_image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={(page as any).og_image}
                                alt="OG"
                                title="Immagine OG — clicca per cambiare"
                                onClick={() => setOgPickerSlug(ogPickerSlug === page.slug ? null : page.slug)}
                                style={{ width: '36px', height: '24px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer', border: '1px solid #e5e7eb' }}
                              />
                            ) : (
                              <button
                                onClick={() => setOgPickerSlug(ogPickerSlug === page.slug ? null : page.slug)}
                                title="Imposta immagine OG"
                                style={{ background: 'transparent', border: '1px dashed #d1d5db', borderRadius: '4px', width: '36px', height: '24px', cursor: 'pointer', fontSize: '0.8rem', color: '#9b9896', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >+</button>
                            )}
                          </div>

                          {/* In menu toggle */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              onClick={() => updatePageField(page.slug, 'inMenu', !inMenu)}
                              style={{
                                width: '34px', height: '18px', borderRadius: '9px', border: 'none', cursor: 'pointer',
                                background: inMenu ? C.blue : C.border,
                                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                              }}
                            >
                              <span style={{
                                position: 'absolute', top: '2px', left: inMenu ? '18px' : '2px',
                                width: '14px', height: '14px', background: 'white', borderRadius: '50%',
                                transition: 'left 0.2s', display: 'block',
                              }} />
                            </button>
                          </div>

                          {/* Actions */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              onClick={() => handleDuplicatePage(page.slug)}
                              title="Duplica"
                              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '3px 7px', fontSize: '0.72rem', cursor: 'pointer', color: C.text }}
                            >⧉</button>
                            {page.slug !== 'home' && (
                              <button
                                onClick={() => handleDeletePage(page.slug)}
                                title="Elimina"
                                style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '3px 7px', fontSize: '0.72rem', cursor: 'pointer', color: '#ef4444' }}
                              >✕</button>
                            )}
                          </div>
                        </div>

                        {/* OG image picker dropdown */}
                        {ogPickerSlug === page.slug && (
                          <div style={{ padding: '10px 12px', borderTop: '1px solid #e5e7eb', background: '#f8fafc' }}>
                            <div style={{ fontSize: '0.7rem', color: '#9b9896', marginBottom: '2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scegli immagine OG per questa pagina</div>
                            <div style={{ fontSize: '0.66rem', color: '#9b9896', marginBottom: '8px' }}>Auto-ridimensionata a 1200×630px</div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              {mediaItems.slice(0, 16).map(item => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={item.path}
                                  src={item.url}
                                  alt=""
                                  onClick={() => { void savePageOgImage(page.slug, item.url); setOgPickerSlug(null) }}
                                  style={{
                                    width: '48px', height: '32px', objectFit: 'cover',
                                    borderRadius: '4px', cursor: 'pointer',
                                    border: (page as any).og_image === item.url ? '2px solid #2563eb' : '1px solid #e5e7eb',
                                  }}
                                />
                              ))}
                              {(page as any).og_image && (
                                <button
                                  onClick={() => { void savePageOgImage(page.slug, ''); setOgPickerSlug(null) }}
                                  style={{ fontSize: '0.68rem', color: '#dc2626', background: 'transparent', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit' }}
                                >Rimuovi</button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Expanded settings panel */}
                        {isExpanded && (() => {
                          const ph = page.html ?? ''
                          const titleTag = (ph.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
                          const desc = (ph.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '').trim()
                          const lang = (ph.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? projectContext?.language ?? 'es').slice(0, 2).toLowerCase()
                          const localeMap: Record<string, string> = { es: 'es_ES', it: 'it_IT', en: 'en_US', fr: 'fr_FR', de: 'de_DE', pt: 'pt_PT', ca: 'ca_ES' }
                          const base = publicBaseUrl || `https://www.${ROOT_DOMAIN}`
                          const canonical = `${base}/${page.slug === 'home' ? '' : page.slug}`
                          const ogImg = (page as Page).og_image || defaultOgImage
                          const ogTitleResolved = (page as Page).og_title || titleTag || page.name

                          // Shared styles
                          const panelBox: React.CSSProperties = { borderTop: `1px solid ${C.border}`, padding: '16px 18px', background: '#f9f9f8', display: 'flex', flexDirection: 'column', gap: '0' }
                          const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '8px 0' }
                          const fieldLbl: React.CSSProperties = { width: '130px', flexShrink: 0, fontSize: '0.7rem', fontWeight: 700, color: '#44403c', textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: '8px', lineHeight: 1.3 }
                          const fieldVal: React.CSSProperties = { flex: 1, minWidth: 0 }
                          const inp: React.CSSProperties = { width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '7px 11px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: 'white' }
                          const ro: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '7px 11px', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace', color: '#57534e', background: '#f4f4f5', boxSizing: 'border-box' as const }
                          const help: React.CSSProperties = { margin: '4px 0 0', fontSize: '0.67rem', color: C.textFaint }
                          const divider: React.CSSProperties = { height: '1px', background: C.border, margin: '6px 0' }
                          const LOCK = (tip = 'Parametro impostato automaticamente dal sistema') => (
                            <span title={tip} style={{ fontSize: '0.8rem', cursor: 'help', flexShrink: 0, color: '#a8a29e' }}>🔒</span>
                          )

                          return (
                            <div style={panelBox}>

                              {/* Nome pagina */}
                              <div style={fieldRow}>
                                <span style={fieldLbl}>Nome pagina</span>
                                <div style={fieldVal}>
                                  <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') setRenamingSlug(null) }}
                                    onBlur={async e => { const v = e.target.value.trim(); if (v && v !== page.name) { const next = pages.map(p => p.slug === page.slug ? { ...p, name: v } : p); setPages(next); await saveState(messages, next) } }}
                                    style={inp} />
                                </div>
                              </div>

                              {/* Etichetta menu */}
                              <div style={fieldRow}>
                                <span style={fieldLbl}>Etichetta menu</span>
                                <div style={fieldVal}>
                                  <input placeholder={page.name} value={menuLabelValue} onChange={e => setMenuLabelValue(e.target.value)}
                                    onBlur={async e => { const v = e.target.value.trim(); if (v !== (page.menuLabel ?? '')) { const next = pages.map(p => p.slug === page.slug ? { ...p, menuLabel: v || page.name } : p); const synced = reorderNavLinks(next); setPages(synced); await saveState(messages, synced) } }}
                                    style={inp} />
                                  <p style={help}>Testo nella navigazione del sito</p>
                                </div>
                              </div>

                              {/* URL */}
                              <div style={fieldRow}>
                                <span style={fieldLbl}>URL</span>
                                <div style={fieldVal}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontSize: '0.78rem', color: C.textFaint, fontFamily: 'monospace', flexShrink: 0 }}>/</span>
                                    <input value={editSlugValue} disabled={page.slug === 'home'} placeholder={page.slug}
                                      onChange={e => setEditSlugValue(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_/]/g, ''))}
                                      onKeyDown={e => { if (e.key === 'Enter') void renamePageSlug(page.slug, editSlugValue); if (e.key === 'Escape') setRenamingSlug(null) }}
                                      style={{ ...inp, fontFamily: 'ui-monospace, monospace', background: page.slug === 'home' ? '#f4f4f5' : 'white', flex: 1 }} />
                                    {page.slug !== 'home' && editSlugValue !== page.slug && <span style={{ fontSize: '0.68rem', color: C.blue }}>✎</span>}
                                  </div>
                                  <p style={help}>{page.slug === 'home' ? 'La home non può essere rinominata' : 'Esci dal campo per aggiornare i link interni'}</p>
                                </div>
                              </div>

                              <div style={divider} />

                              {/* No Index / No Follow */}
                              {(['noindex', 'nofollow'] as const).map(key => {
                                const on = !!(page as Page).robots?.[key]
                                const lbl = key === 'noindex' ? 'No Index' : 'No Follow'
                                const sub = key === 'noindex' ? 'Escludi da Google' : 'Non seguire i link'
                                return (
                                  <div key={key} style={fieldRow}>
                                    <span style={fieldLbl}>{lbl}</span>
                                    <div style={{ ...fieldVal, display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '5px' }}>
                                      <div onClick={() => updatePageRobots(page.slug, key, !on)}
                                        style={{ position: 'relative', width: '34px', height: '18px', borderRadius: '9px', background: on ? '#ef4444' : C.border, cursor: 'pointer', transition: 'background .15s', flexShrink: 0 }}>
                                        <div style={{ position: 'absolute', top: '2px', left: on ? '18px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', transition: 'left .15s' }} />
                                      </div>
                                      <span style={{ fontSize: '0.76rem', color: on ? '#ef4444' : C.textFaint }}>{sub}</span>
                                    </div>
                                  </div>
                                )
                              })}

                              <div style={divider} />

                              {/* Canonical */}
                              <div style={fieldRow}>
                                <span style={fieldLbl}>Canonical</span>
                                <div style={{ ...fieldVal, ...ro }}>
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{canonical}</span>
                                  {LOCK('Generato automaticamente dal dominio pubblicato')}
                                </div>
                              </div>

                              <div style={divider} />

                              {/* og:title editabile */}
                              <div style={fieldRow}>
                                <span style={fieldLbl}>og:title</span>
                                <div style={fieldVal}>
                                  <input key={`og_title_${page.slug}`} defaultValue={(page as Page).og_title ?? ''} placeholder={ogTitleResolved}
                                    onBlur={e => { const v = e.target.value.trim(); if (v !== ((page as Page).og_title ?? '')) void updatePageField(page.slug, 'og_title', v) }}
                                    style={inp} />
                                  <p style={help}>Se vuoto usa il titolo della pagina</p>
                                </div>
                              </div>

                              {/* Campi OG read-only */}
                              {[
                                { k: 'og:description', v: desc || 'meta description mancante', warn: !desc },
                                { k: 'og:type',        v: 'website' },
                                { k: 'og:url',         v: canonical },
                                { k: 'og:site_name',   v: projectContext?.businessName || projectName || '—' },
                                { k: 'og:locale',      v: localeMap[lang] ?? 'es_ES' },
                                { k: 'og:image',       v: ogImg ? ((page as Page).og_image ? 'pagina' : 'default sito') : 'mancante — usa OG IMG', warn: !ogImg },
                                { k: 'og:image:alt',   v: ogImg ? ogTitleResolved : '—' },
                                { k: 'og:image:width', v: ogImg ? '1200' : '—' },
                                { k: 'og:image:height',v: ogImg ? '630' : '—' },
                              ].map(r => (
                                <div key={r.k} style={fieldRow}>
                                  <span style={{ ...fieldLbl, fontFamily: 'ui-monospace, monospace', textTransform: 'none', letterSpacing: 0 }}>{r.k}</span>
                                  <div style={{ ...fieldVal, ...ro, color: r.warn ? '#dc2626' : '#78716c' }}>
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.v}</span>
                                    {LOCK()}
                                  </div>
                                </div>
                              ))}

                              <div style={{ ...divider, marginTop: '8px' }} />

                              {/* Fase 2c — Block reorder UI */}
                              {(page as Page).blocks && (page as Page).blocks!.length > 0 && (() => {
                                const blocks = [...(page as Page).blocks!].sort((a, b) => a.order - b.order)
                                const blockDragRef = { current: null as number | null }
                                return (
                                  <div style={{ paddingTop: '8px' }}>
                                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#44403c', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                                      Sezioni ({blocks.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                      {blocks.filter(b => b.type !== 'style' && b.type !== 'script').map((block, bi) => (
                                        <div
                                          key={block.id}
                                          draggable
                                          onDragStart={() => { blockDragRef.current = bi }}
                                          onDragOver={e => e.preventDefault()}
                                          onDrop={async () => {
                                            const from = blockDragRef.current
                                            if (from === null || from === bi) return
                                            blockDragRef.current = null
                                            // Reorder blocks
                                            const reordered = [...blocks.filter(b => b.type !== 'style' && b.type !== 'script')]
                                            const [moved] = reordered.splice(from, 1)
                                            reordered.splice(bi, 0, moved)
                                            // Reassign order
                                            const styleBlocks = blocks.filter(b => b.type === 'style' || b.type === 'script')
                                            const allBlocks = [...styleBlocks, ...reordered.map((b, i) => ({ ...b, order: styleBlocks.length + i }))]
                                            const { assembleBlocksToHtml: asm } = await import('../../../lib/agents/block-splitter')
                                            const newHtml = asm(allBlocks, page.html)
                                            const next = pages.map(p => p.slug === page.slug ? { ...p, html: newHtml, blocks: allBlocks } : p)
                                            setPages(next)
                                            await saveState(messages, next)
                                          }}
                                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', background: 'white', border: `1px solid ${C.border}`, borderRadius: '6px', cursor: 'grab', fontSize: '0.72rem', color: '#57534e' }}
                                        >
                                          <span style={{ color: C.textFaint, fontSize: '0.8rem' }}>⠿</span>
                                          <span style={{ fontFamily: 'ui-monospace, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.selector}</span>
                                          <span style={{ fontSize: '0.65rem', color: C.textFaint, flexShrink: 0 }}>{block.type}</span>
                                          {/* Rigenera blocco */}
                                          <button
                                            onClick={e => {
                                              e.stopPropagation()
                                              const msg = `Rigenera completamente la sezione ${block.selector} della pagina ${page.name} — ridisegnala creativamente mantenendo contenuto e stile`
                                              const fakeEvent = { preventDefault: () => {} } as React.FormEvent
                                              setActiveSlug(page.slug)
                                              handleSendRef.current?.(fakeEvent, { input: msg, images: [] })
                                            }}
                                            title="Rigenera questa sezione"
                                            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', padding: '1px 5px', fontSize: '0.65rem', cursor: 'pointer', color: C.blue, flexShrink: 0 }}
                                          >🔄</button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })()}

                              <div style={{ ...divider, marginTop: '8px' }} />

                              {/* Bottoni editor */}
                              <div style={{ display: 'flex', gap: '8px', paddingTop: '10px', flexWrap: 'wrap' }}>
                                <button onClick={() => { setActiveSlug(page.slug); setViewMode('edit') }}
                                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer', color: C.text, fontFamily: 'inherit', fontWeight: 500 }}>
                                  ✎ Editor
                                </button>
                                <button onClick={() => { setActiveSlug(page.slug); setViewMode('preview') }}
                                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer', color: C.text, fontFamily: 'inherit', fontWeight: 500 }}>
                                  🌐 Anteprima
                                </button>
                              </div>

                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()
        ) : viewMode === 'integrations' ? (
          /* ── Components Panel ───────────────────────────────────────────────── */
          (() => {
            const allHtml = pages.map(p => p.html).join('\n')
            const hasContactForm = /comp-cf-form|action="\/api\/forms/i.test(allHtml)
            const hasCrmForm     = /modulo.*CRM|tipo.*CRM|avisar.*disponible/i.test(allHtml)
            const hasSuggestForm = /sugerencia-modulo|suggest-module-form|suggest-modal/i.test(allHtml)
            const cfPages      = pages.filter(p => /comp-cf-form|action="\/api\/forms/i.test(p.html)).map(p => p.name).join(', ')
            const crmPages     = pages.filter(p => /modulo.*CRM|tipo.*CRM|avisar.*disponible/i.test(p.html)).map(p => p.name).join(', ')
            const suggestPages = pages.filter(p => /sugerencia-modulo|suggest-module-form|suggest-modal/i.test(p.html)).map(p => p.name).join(', ')

            const components = [
              { key: 'contact_form'  as const, icon: '📧', label: 'Form di contatto',        pages: cfPages,      active: hasContactForm },
              { key: 'crm_form'      as const, icon: '💼', label: 'Form interesse CRM',       pages: crmPages,     active: hasCrmForm },
              { key: 'suggest_form'  as const, icon: '💡', label: 'Form suggerisci modulo',   pages: suggestPages, active: hasSuggestForm },
            ]

            return (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', background: C.bg }}>
                <div style={{ maxWidth: '680px', margin: '0 auto' }}>
                  <div style={{ marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: C.text }}>⚙️ Componenti</h2>
                    <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: C.textFaint }}>Configura il comportamento dei componenti attivi nel sito.</p>
                  </div>

                  {/* ── Table header ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px', gap: '0 12px', padding: '0 16px 8px', borderBottom: `1px solid ${C.border}` }}>
                    {(['COMPONENTE','PAGINE','STATO'] as const).map(h => (
                      <span key={h} style={{ fontSize: '0.68rem', fontWeight: 700, color: C.textFaint, letterSpacing: '0.06em' }}>{h}</span>
                    ))}
                  </div>

                  {/* ── Component rows ── */}
                  <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden', marginTop: '8px' }}>
                    {components.map((comp, i) => {
                      const isOpen = activeComponent === comp.key
                      return (
                        <div key={comp.key} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                          {/* Row */}
                          <div
                            onClick={() => setActiveComponent(isOpen ? null : comp.key)}
                            style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px', gap: '0 12px', alignItems: 'center', padding: '13px 16px', cursor: 'pointer', background: isOpen ? '#f8faff' : C.white, transition: 'background 0.15s' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{ fontSize: '1rem' }}>{comp.icon}</span>
                              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: C.text }}>{comp.label}</span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: C.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                              {comp.pages || '—'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, background: comp.active ? '#dcfce7' : '#f3f4f6', color: comp.active ? '#166534' : C.textFaint }}>
                                {comp.active ? '● Attiva' : '○ —'}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: C.textFaint, marginLeft: '6px', transform: isOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▾</span>
                            </div>
                          </div>

                          {/* Detail panel */}
                          {isOpen && (
                            <div style={{ padding: '20px 20px 24px', borderTop: `1px solid ${C.border}`, background: '#fafbff' }}>
                              {comp.key === 'contact_form' && (
                                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '14px' }}>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Email notifica interna</label>
                                    <input type="email" placeholder="info@tuosito.com" value={cfAdminEmail} onChange={e => setCfAdminEmail(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Notifica inviata ad ogni compilazione</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio di conferma (pagina)</label>
                                    <input type="text" placeholder="¡Mensaje enviado! Te responderemos pronto." value={cfConfirmMsg} onChange={e => setCfConfirmMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Testo mostrato sulla pagina dopo l&apos;invio</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio email di conferma</label>
                                    <textarea placeholder="Hola [nombre], Hemos recibido tu mensaje. Te responderemos a [email]." value={cfConfirmEmailMsg} onChange={e => setCfConfirmEmailMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, minHeight: '60px', resize: 'none' }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>{'Usa [nombre] e [email] come placeholder'}</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>URL pagina di destinazione</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>./</span>
                                      <input type="text" placeholder="formulario-confirmado" value={cfRedirectUrl} onChange={e => setCfRedirectUrl(e.target.value)}
                                        style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'monospace', outline: 'none', background: C.white, color: C.text }} />
                                    </div>
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Redirect automatico 2 secondi dopo l&apos;invio</p>
                                  </div>
                                  <div style={{ padding: '10px 14px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: cfTurnstileSiteKey ? '0' : '8px' }}>
                                      <span>🛡️</span>
                                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#3730a3', textTransform: 'uppercase' as const, letterSpacing: '0.05em', flex: 1 }}>Cloudflare Turnstile</span>
                                      {cfTurnstileSiteKey && <span style={{ fontSize: '0.69rem', color: '#166534', background: '#dcfce7', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>✓ Configurata</span>}
                                    </div>
                                    {!cfTurnstileSiteKey && (
                                      <p style={{ margin: '0 0 8px', fontSize: '0.69rem', color: '#4338ca', lineHeight: '1.5' }}>
                                        {'dash.cloudflare.com → Turnstile → crea widget → copia Site Key'}<br/>
                                        {'Secret Key → Vercel env var: CLOUDFLARE_TURNSTILE_SECRET'}
                                      </p>
                                    )}
                                    <input type="text" placeholder="0x4AAAAAAA... (Site Key pubblica)" value={cfTurnstileSiteKey} onChange={e => setCfTurnstileSiteKey(e.target.value)}
                                      style={{ width: '100%', border: '1px solid #c7d2fe', borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, marginTop: cfTurnstileSiteKey ? '8px' : '0' }} />
                                  </div>
                                  <div style={{ paddingTop: '4px' }}>
                                    <button onClick={() => void saveContactFormConfig()} disabled={cfSaving === 'saving'}
                                      style={{ background: C.blue, color: 'white', border: 'none', borderRadius: '7px', padding: '9px 22px', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                                      {cfSaving === 'saving' ? 'Salvataggio…' : cfSaving === 'saved' ? '✓ Salvato' : 'Salva'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {comp.key === 'crm_form' && (
                                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '14px' }}>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Email notifica interna</label>
                                    <input type="email" placeholder={cfAdminEmail || 'info@tuosito.com'} value={crmAdminEmail} onChange={e => setCrmAdminEmail(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Lascia vuoto per usare la stessa della Contact Form</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio di conferma (pagina)</label>
                                    <input type="text" placeholder="¡Gracias! Te avisaremos cuando esté disponible." value={crmConfirmMsg} onChange={e => setCrmConfirmMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Testo mostrato dopo l&apos;invio</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio email di conferma</label>
                                    <textarea placeholder="Hola [nombre], Hemos recibido tu interés en el CRM. Te avisaremos a [email]." value={crmConfirmEmailMsg} onChange={e => setCrmConfirmEmailMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, minHeight: '60px', resize: 'none' }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>{'Usa [nombre] e [email] come placeholder'}</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>URL pagina di destinazione</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>./</span>
                                      <input type="text" placeholder="gracias-por-tu-interes" value={crmRedirectUrl} onChange={e => setCrmRedirectUrl(e.target.value)}
                                        style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'monospace', outline: 'none', background: C.white, color: C.text }} />
                                    </div>
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Redirect automatico 2 secondi dopo l&apos;invio</p>
                                  </div>
                                  <div style={{ padding: '10px 14px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: crmTurnstileSiteKey ? '0' : '8px' }}>
                                      <span>🛡️</span>
                                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#3730a3', textTransform: 'uppercase' as const, letterSpacing: '0.05em', flex: 1 }}>Cloudflare Turnstile</span>
                                      {crmTurnstileSiteKey && <span style={{ fontSize: '0.69rem', color: '#166534', background: '#dcfce7', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>✓ Configurata</span>}
                                    </div>
                                    {!crmTurnstileSiteKey && (
                                      <p style={{ margin: '0 0 8px', fontSize: '0.69rem', color: '#4338ca', lineHeight: '1.5' }}>
                                        {'dash.cloudflare.com → Turnstile → crea widget → copia Site Key'}<br/>
                                        {'Secret Key → Vercel env var: CLOUDFLARE_TURNSTILE_SECRET'}
                                      </p>
                                    )}
                                    <input type="text" placeholder="0x4AAAAAAA... (Site Key pubblica)" value={crmTurnstileSiteKey} onChange={e => setCrmTurnstileSiteKey(e.target.value)}
                                      style={{ width: '100%', border: '1px solid #c7d2fe', borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, marginTop: crmTurnstileSiteKey ? '8px' : '0' }} />
                                  </div>
                                  <div style={{ paddingTop: '4px' }}>
                                    <button onClick={() => void saveCrmConfig()} disabled={crmSaving === 'saving'}
                                      style={{ background: C.blue, color: 'white', border: 'none', borderRadius: '7px', padding: '9px 22px', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                                      {crmSaving === 'saving' ? 'Salvataggio…' : crmSaving === 'saved' ? '✓ Salvato' : 'Salva'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {comp.key === 'suggest_form' && (
                                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '14px' }}>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Email notifica interna</label>
                                    <input type="email" placeholder={cfAdminEmail || 'info@tuosito.com'} value={suggestAdminEmail} onChange={e => setSuggestAdminEmail(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Lascia vuoto per usare la stessa della Contact Form</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio di conferma (pagina)</label>
                                    <input type="text" placeholder="¡Gracias! Hemos recibido tu sugerencia." value={suggestConfirmMsg} onChange={e => setSuggestConfirmMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Testo mostrato dopo l&apos;invio</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Messaggio email di conferma</label>
                                    <textarea placeholder="Hola [nombre], Hemos recibido tu sugerencia de módulo. La tendremos en cuenta." value={suggestConfirmEmailMsg} onChange={e => setSuggestConfirmEmailMsg(e.target.value)}
                                      style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, minHeight: '60px', resize: 'none' }} />
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>{'Usa [nombre] e [email] come placeholder'}</p>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>URL pagina di destinazione</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '0.8rem', color: C.textFaint, whiteSpace: 'nowrap' as const }}>./</span>
                                      <input type="text" placeholder="gracias-por-tu-sugerencia" value={suggestRedirectUrl} onChange={e => setSuggestRedirectUrl(e.target.value)}
                                        style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontSize: '0.85rem', fontFamily: 'monospace', outline: 'none', background: C.white, color: C.text }} />
                                    </div>
                                    <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Redirect automatico 2 secondi dopo l&apos;invio</p>
                                  </div>
                                  <div style={{ padding: '10px 14px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: suggestTurnstileSiteKey ? '0' : '8px' }}>
                                      <span>🛡️</span>
                                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#3730a3', textTransform: 'uppercase' as const, letterSpacing: '0.05em', flex: 1 }}>Cloudflare Turnstile</span>
                                      {suggestTurnstileSiteKey && <span style={{ fontSize: '0.69rem', color: '#166534', background: '#dcfce7', padding: '1px 7px', borderRadius: '10px', fontWeight: 600 }}>✓ Configurata</span>}
                                    </div>
                                    {!suggestTurnstileSiteKey && (
                                      <p style={{ margin: '0 0 8px', fontSize: '0.69rem', color: '#4338ca', lineHeight: '1.5' }}>
                                        {'dash.cloudflare.com → Turnstile → crea widget → copia Site Key'}<br/>
                                        {'Secret Key → Vercel env var: CLOUDFLARE_TURNSTILE_SECRET'}
                                      </p>
                                    )}
                                    <input type="text" placeholder="0x4AAAAAAA... (Site Key pubblica)" value={suggestTurnstileSiteKey} onChange={e => setSuggestTurnstileSiteKey(e.target.value)}
                                      style={{ width: '100%', border: '1px solid #c7d2fe', borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const, background: C.white, color: C.text, marginTop: suggestTurnstileSiteKey ? '8px' : '0' }} />
                                  </div>
                                  <div style={{ paddingTop: '4px' }}>
                                    <button onClick={() => void saveSuggestConfig()} disabled={suggestSaving === 'saving'}
                                      style={{ background: C.blue, color: 'white', border: 'none', borderRadius: '7px', padding: '9px 22px', fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                                      {suggestSaving === 'saving' ? 'Salvataggio…' : suggestSaving === 'saved' ? '✓ Salvato' : 'Salva'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()
        ) : (
          /* Preview mode — no sidebar, full width */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {activePage ? (
                <iframe
                  ref={previewIframeRef}
                  // When a blog article path is set, load it via src (served by blog route).
                  // For regular pages use srcDoc (inline HTML, no round-trip needed).
                  {...(previewIframePath && previewIframePath !== '/'
                    ? { src: `/preview/${projectSlug}${previewIframePath}`, key: previewIframePath }
                    : { srcDoc: injectBasePreview(activePage.html, projectSlug, sharedNavHtmlRef.current || undefined, sharedFooterHtmlRef.current || undefined, sharedCssRef.current || undefined, faviconUrlRef.current || undefined) }
                  )}
                  style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
                  title="Preview"
                  sandbox="allow-scripts allow-same-origin"
                  onLoad={() => {
                    // Sync URL bar with iframe internal navigation (e.g. clicking Blog in site nav)
                    try {
                      const pathname = previewIframeRef.current?.contentWindow?.location?.pathname ?? ''
                      const previewPrefix = `/preview/${projectSlug}/`
                      const previewBase = `/preview/${projectSlug}`
                      if (pathname.startsWith(previewPrefix)) {
                        setPreviewIframePath('/' + pathname.slice(previewPrefix.length))
                      } else if (pathname === previewBase || pathname === previewBase + '/') {
                        setPreviewIframePath(null) // home — use activeSlug
                      }
                    } catch {
                      // cross-origin or srcdoc — ignore
                    }
                    if (scrollTarget) {
                      previewIframeRef.current?.contentWindow?.postMessage({ type: 'scroll-to-text', text: scrollTarget }, '*')
                      setScrollTarget(null)
                    }
                  }}
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
              <button onClick={() => { setShowSettingsModal(false); setDnsInstructions(''); setRegistrarInfo(null); setShowManualDns(false) }}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: C.textFaint }}>Dominio personalizzato</p>
                      <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontFamily: 'monospace', color: C.text, fontWeight: 500 }}>{customDomain}</p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#059669' }}>✓ Verificato e attivo</p>
                    </div>
                    <button
                      onClick={handleRemoveDomain}
                      disabled={removingDomain}
                      style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {removingDomain ? '...' : '✏️ Cambia'}
                    </button>
                  </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: C.textMuted }}>In attesa di verifica DNS</span>
                    {verifying && <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>● Verifica in corso...</span>}
                  </div>
                  <button
                    onClick={handleRemoveDomain}
                    disabled={removingDomain}
                    style={{ background: 'none', border: 'none', color: C.textFaint, cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {removingDomain ? '...' : '✏️ Cambia'}
                  </button>
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
                  onBlur={(e) => handleDetectRegistrar(e.target.value)}
                  disabled={addingDomain || cfConfiguring}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '10px', fontSize: '0.875rem', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none' }}
                />

                {/* Registrar detection result */}
                {detectingRegistrar && (
                  <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: C.textMuted }}>🔍 Rilevamento registrar in corso...</p>
                )}

                {!detectingRegistrar && registrarInfo?.isCloudflare && !showManualDns && (
                  <div style={{ marginBottom: '12px', padding: '12px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fbbf24' }}>
                    <p style={{ margin: '0 0 10px', fontSize: '0.8125rem', fontWeight: 600, color: '#92400e' }}>⚡ Cloudflare DNS rilevato — configurazione automatica disponibile</p>
                    <input
                      type="password"
                      placeholder="Token API Cloudflare (DNS:Edit)"
                      value={cfApiToken}
                      onChange={(e) => setCfApiToken(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', marginBottom: '8px', fontSize: '0.8125rem', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none' }}
                    />
                    <input
                      type="text"
                      placeholder="Zone ID del dominio"
                      value={cfZoneId}
                      onChange={(e) => setCfZoneId(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', marginBottom: '6px', fontSize: '0.8125rem', boxSizing: 'border-box' as const, fontFamily: 'inherit', outline: 'none' }}
                    />
                    <p style={{ margin: '0 0 10px', fontSize: '0.72rem', color: C.textMuted }}>
                      Crea il token su{' '}
                      <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" style={{ color: C.blue }}>
                        dash.cloudflare.com/profile/api-tokens
                      </a>{' '}
                      con permesso <strong>DNS:Edit</strong> per la zona.
                    </p>
                    <button
                      type="button"
                      onClick={handleConfigureCloudflare}
                      disabled={cfConfiguring || !cfApiToken.trim() || !cfZoneId.trim() || !customDomain.trim()}
                      style={{ width: '100%', padding: '9px', background: cfConfiguring || !cfApiToken.trim() || !cfZoneId.trim() ? '#d6d3d1' : '#d97706', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: cfConfiguring || !cfApiToken.trim() || !cfZoneId.trim() ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontFamily: 'inherit', marginBottom: '8px' }}>
                      {cfConfiguring ? '⏳ Configurazione...' : '⚡ Configura DNS automaticamente'}
                    </button>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: C.textMuted, textAlign: 'center' }}>
                      <button type="button" onClick={() => setShowManualDns(true)} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: '0.72rem', padding: 0, fontFamily: 'inherit' }}>
                        Preferisci configurare manualmente?
                      </button>
                    </p>
                  </div>
                )}

                {!detectingRegistrar && registrarInfo && !registrarInfo.isCloudflare && (
                  <div style={{ marginBottom: '12px', padding: '12px 14px', background: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                    <p style={{ margin: '0 0 6px', fontSize: '0.8125rem', fontWeight: 600, color: '#1e40af' }}>
                      {registrarInfo.registrarName ? `Registrar rilevato: ${registrarInfo.registrarName}` : 'Registrar non riconosciuto'}
                    </p>
                    {registrarInfo.dnsPanel && (
                      <a
                        href={registrarInfo.dnsPanel}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-block', marginBottom: '10px', fontSize: '0.8rem', color: C.blue, textDecoration: 'none', fontWeight: 500 }}>
                        Apri pannello DNS{registrarInfo.registrarKey ? ` di ${registrarInfo.registrarKey}` : ''} →
                      </a>
                    )}
                    <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.78rem', color: '#f8f8f8', marginBottom: registrarInfo.note ? '8px' : '0' }}>
                      <div>Tipo:   CNAME</div>
                      <div>Nome:   @</div>
                      <div>Valore: cname.vercel-dns.com</div>
                      <div>TTL:    auto (o 3600)</div>
                    </div>
                    {registrarInfo.note && (
                      <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: C.textMuted }}>{registrarInfo.note}</p>
                    )}
                  </div>
                )}

                {/* Manual DNS fallback: show when no registrar info or user explicitly wants it */}
                {!detectingRegistrar && (showManualDns || !registrarInfo) && (
                  <div style={{ marginBottom: '12px', padding: '12px 14px', background: C.bg, borderRadius: '10px', border: `1px solid ${C.border}` }}>
                    <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', fontWeight: 600, color: C.text }}>Configura questo record CNAME nel tuo DNS:</p>
                    <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.78rem', color: '#f8f8f8' }}>
                      <div>Tipo:   CNAME</div>
                      <div>Nome:   @</div>
                      <div>Valore: cname.vercel-dns.com</div>
                      <div>TTL:    auto (o 3600)</div>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={addingDomain || !customDomain.trim()}
                  style={{ width: '100%', padding: '9px', background: customDomain.trim() && !addingDomain ? C.dark : '#d6d3d1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: customDomain.trim() && !addingDomain ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontFamily: 'inherit' }}>
                  {addingDomain ? '⏳ Configurazione...' : 'Aggiungi dominio'}
                </button>
              </form>
            )}

            <button
              onClick={() => { setShowSettingsModal(false); setDnsInstructions(''); setRegistrarInfo(null); setShowManualDns(false) }}
              style={{ width: '100%', padding: '9px', background: C.bgPanel, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem' }}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* ── Paywall Modal — shown when credits run out ── */}
      {/* ── Media picker modal (Inserisci immagine from editors) ── */}
      {mediaPickerTarget && (
        <div
          onClick={() => setMediaPickerTarget(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.22)', width: '560px', maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: C.text }}>Seleziona immagine</span>
              <button onClick={() => setMediaPickerTarget(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: C.textMuted, lineHeight: 1 }}>✕</button>
            </div>
            {/* Upload button */}
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}` }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: C.blue, color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Carica nuova immagine
                <input ref={mediaPickerUploadRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleMediaPickerUpload(f); e.target.value = '' }}
                />
              </label>
            </div>
            {/* Grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {mediaItems.length === 0 ? (
                <p style={{ color: C.textFaint, fontSize: '0.85rem', textAlign: 'center', marginTop: '24px' }}>Nessuna immagine caricata. Usa il pulsante sopra per caricare.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px' }}>
                  {mediaItems.map(item => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={item.path}
                      src={item.url}
                      alt={item.name}
                      title={item.name}
                      onClick={() => insertMediaImageUrl(item.url, mediaMeta[item.path])}
                      style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, cursor: 'pointer', border: `1px solid ${C.border}`, transition: 'transform 0.1s, box-shadow 0.1s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showPaywall && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001, backdropFilter: 'blur(4px)' }}
          onClick={() => setShowPaywall(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '16px', padding: '2rem', maxWidth: '440px', width: '90%', boxShadow: '0 24px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}
          >
            <div style={{ fontSize: '2.4rem', marginBottom: '0.5rem' }}>⚡</div>
            <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.25rem', fontWeight: 700, color: '#1c1917' }}>
              {creditsBalance !== null && creditsBalance < 500 ? 'Crediti esauriti' : 'Ricarica crediti'}
            </h2>
            <p style={{ margin: '0 0 1.2rem', fontSize: '0.92rem', color: '#57534e', lineHeight: 1.55 }}>
              {creditsBalance !== null
                ? <>Hai <strong>{creditsBalance.toLocaleString('it-IT')}</strong> crediti residui. Ogni interazione con l&apos;AI consuma crediti — ricarica per continuare a usare Factulista.</>
                : 'Ricarica il tuo wallet per usare l\'AI.'}
            </p>
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px', marginBottom: '1.2rem', fontSize: '0.82rem', color: '#92400e' }}>
              💳 Pagamenti via Stripe in arrivo — contattaci a <a href="mailto:support@factulista.com" style={{ color: '#92400e', fontWeight: 600 }}>support@factulista.com</a> per una ricarica manuale nel frattempo.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowPaywall(false)}
                style={{ flex: 1, padding: '10px', background: '#f5f5f4', color: '#44403c', border: '1px solid #e7e5e4', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit' }}
              >
                Chiudi
              </button>
              <a
                href="mailto:support@factulista.com?subject=Ricarica%20crediti%20Factulista"
                style={{ flex: 1, padding: '10px', background: '#1c1917', color: '#fff', border: '1px solid #1c1917', borderRadius: '10px', fontWeight: 600, textDecoration: 'none', fontSize: '0.875rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Contattaci
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Component Canvas drawer ── */}
      {showComponentCanvas && (
        <ComponentCanvas
          projectId={id}
          designTokensCss={designTokensCss}
          onInsert={handleInsertComponent}
          onClose={() => setShowComponentCanvas(false)}
        />
      )}
    </main>
  )
}
