'use client'

import { useState, use, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { confirmDialog, alertDialog } from '../../../lib/dialog'
import { EditorSidebar } from '../../../components/EditorSidebar'
import { HtmlCodeEditor } from '../../../components/HtmlCodeEditor'
import { useLanguage } from '../../../lib/i18n/useLanguage'
import { t } from '../../../lib/i18n/translations'
import { analyzeAllPages, getAggregateScore, scoreColor, type PageAnalysis, type CheckResult } from '../../../lib/seo/analyzer'
import { SEO_CHECKS, SEO_GROUPS, type CheckId } from '../../../lib/seo/checks'
import type { Page } from '../../../lib/types'
import { BLOG_POST_CONTENT_CSS, buildBlogPostPage, type Post as BlogServePost } from '../../../lib/blog-serve'
import { renderComponentById } from '../../../lib/components/index'

type Message = { id: string; role: 'user' | 'assistant'; content: string; images?: string[]; progressSteps?: { step: string; time: string }[]; failed?: boolean; retryInput?: string; retryImages?: string[] }
type Version = { id: string; timestamp: string; summary: string; pages: Page[] }
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
      ['#fact-edit-global','#fact-edit-script','#fact-edit-marker','#fact-ctx-menu','#fact-link-overlay'].forEach(function(sel){
        var el=clone.querySelector(sel);if(el)el.remove();
      });
      window.parent.postMessage({type:'html-change',html:'<!DOCTYPE html>\\n'+clone.outerHTML},'*');
    },80);
  }

  // ── Auto-save on text input ────────────────────────────────────────────────
  var saveTimer;
  document.addEventListener('input',function(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(triggerSave,400);
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
  function getTableCell(){
    var sel=window.getSelection();
    if(!sel||!sel.anchorNode) return null;
    var node=sel.anchorNode;
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
    var tCell=getTableCell();
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
          'box-shadow:0 4px 16px rgba(0,0,0,0.1);z-index:100001;overflow:hidden;"></div>'+
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
          '<span style="font-weight:600;color:#1a1a1a">'+p.name+'</span>'+
          '<code style="font-size:12px;color:#2563eb;background:#eff6ff;padding:2px 7px;border-radius:5px">'+p.href+'</code>';
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
      // Restore selection if it was saved before opening a native picker (e.g. color input)
      if(colorSavedRange){
        var csel2=window.getSelection();
        if(csel2){csel2.removeAllRanges();csel2.addRange(colorSavedRange);}
        colorSavedRange=null;
      }
      // Enable CSS-based styling so we get <span style="..."> instead of deprecated tags
      if(cmd==='fontName'||cmd==='foreColor'){document.execCommand('styleWithCSS',false,'true');}
      document.execCommand(cmd,false,val);
      triggerSave();
    }
    if(e.data.type==='fact-link'){
      var anch=getAnchorLink();
      saveSelection();
      showLinkDialog(anch?anch.getAttribute('href'):null);
    }
  });

  // ── Report current block tag to parent for toolbar active state ────────────
  document.addEventListener('selectionchange',function(){
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount) return;
    var node=sel.getRangeAt(0).startContainer;
    var el=node.nodeType===3?node.parentElement:node;
    while(el&&el!==document.body){
      var tag=el.tagName||'';
      if(/^H[1-6]$/.test(tag)||tag==='P'||tag==='BLOCKQUOTE'||tag==='LI'){
        window.parent.postMessage({type:'fact-block',tag:tag},'*');
        return;
      }
      el=el.parentElement;
    }
    window.parent.postMessage({type:'fact-block',tag:'P'},'*');
  });

})();`
} // end buildInlineEditScriptTemplate

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
    // Source of truth: the newly added page (generated with full slug list)
    const newPage = pages.find(p => p.slug === targetSlug)
    if (!newPage) return pages
    const navMatch = newPage.html.match(/<nav[\s\S]*?<\/nav>/i)
    if (!navMatch) return pages
    const newNav = navMatch[0]
    return pages.map(p => {
      if (p.slug === targetSlug) return p
      if (!/<nav[\s\S]*?<\/nav>/i.test(p.html)) return p
      return { ...p, html: p.html.replace(/<nav[\s\S]*?<\/nav>/i, newNav) }
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
  const srcPage = pages.find(p => navRe.test(p.html))
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

  // Map slug → nav item
  const slugToItem = new Map<string, Element>()
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
        // Apply menuLabel if set
        if (page.menuLabel && page.menuLabel !== page.name) a.textContent = page.menuLabel
        break
      }
    }
  }

  // Reorder inside parent
  const parent = items[0].parentElement
  if (parent) {
    items.forEach(el => el.remove())
    for (const page of pages) {
      if (page.inMenu === false) continue
      const item = slugToItem.get(page.slug)
      if (item) parent.appendChild(item)
    }
  }

  const newNavHtml = nav.outerHTML
  return pages.map(p => ({
    ...p,
    html: navRe.test(p.html) ? p.html.replace(navRe, newNavHtml) : p.html,
  }))
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

const SCROLL_LISTENER = `<script>
window.addEventListener('message',function(e){
  if(!e.data||e.data.type!=='scroll-to-text')return;
  var text=e.data.text;if(!text)return;
  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
  var node;
  while((node=walker.nextNode())){
    if(node.textContent&&node.textContent.trim().includes(text.trim())){
      var el=node.parentElement;
      if(el){el.scrollIntoView({behavior:'smooth',block:'center'});break;}
    }
  }
});
</script>`

function injectBase(html: string, projectSlug: string): string {
  const clean = stripEditorArtifacts(html)
  const baseTag = `<base href="/preview/${projectSlug}/">`
  if (/<\/body>/i.test(clean)) {
    return clean
      .replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`)
      .replace(/<\/body>/i, `${SCROLL_LISTENER}</body>`)
  }
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
  const [loadingMsgId, setLoadingMsgId] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const loadingStartRef = useRef<number>(0)
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
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'edit' | 'media' | 'seo' | 'pages' | 'blog'>('preview')
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
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
  const [blogSidebarBannerSaving, setBlogSidebarBannerSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showUrlDropdown, setShowUrlDropdown] = useState(false)
  const [userFullName, setUserFullName] = useState('')
  const [previewIframePath, setPreviewIframePath] = useState<string | null>(null)
  const [blogEditorSrcDoc, setBlogEditorSrcDoc] = useState('')
  const [blogSaving, setBlogSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [blogActiveBlock, setBlogActiveBlock] = useState<string>('')
  const [blogPublishing, setBlogPublishing] = useState(false)
  const [blogGenerating, setBlogGenerating] = useState(false)
  const [blogGenTopic, setBlogGenTopic] = useState('')
  const [showBlogGenPrompt, setShowBlogGenPrompt] = useState(false)
  const [blogMetaEdits, setBlogMetaEdits] = useState<Partial<BlogPost>>({})
  const blogAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blogBaseHtmlRef = useRef<string>('')
  const blogIframeRef = useRef<HTMLIFrameElement>(null)

  const [projectContext, setProjectContext] = useState<{ businessName?: string; businessType?: string; services?: string[]; language?: string; targetAudience?: string }>({})
  const [seoAnalyses, setSeoAnalyses] = useState<PageAnalysis[]>([])
  const [seoPageSlug, setSeoPageSlug] = useState<string>('all')
  const [seoFixing, setSeoFixing] = useState<CheckId | null>(null)
  const [seoFixError, setSeoFixError] = useState<string | null>(null)
  const seoFixingRef = useRef<boolean>(false)
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
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<string | null>(null)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
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

  // Re-analyze SEO whenever pages or blog posts change or the SEO tab is opened.
  // Blog posts are rendered to their published HTML form (same builder used by the
  // /preview and custom-domain routes) so the SEO checks see exactly what Google sees.
  useEffect(() => {
    if (pages.length === 0) return
    // Build "virtual pages" for blog posts using the same renderer as the live site
    const homePage = pages.find(p => p.slug === 'home')
    const homeHtml = homePage?.html ?? ''
    const siteNav = homeHtml.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? ''
    const footerMatches = [...homeHtml.matchAll(/<footer[\s\S]*?<\/footer>/gi)]
    const siteFooter = footerMatches.length > 0 ? footerMatches[footerMatches.length - 1][0] : ''
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

    setSeoAnalyses(analyzeAllPages([...pages, ...blogPagesForSeo]))
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

  // Listen for inline edits on blog post content
  useEffect(() => {
    if (viewMode !== 'blog' || !selectedPost) return
    const handleBlogMessage = (e: MessageEvent) => {
      if (e.data?.type === 'fact-block') {
        setBlogActiveBlock(e.data.tag ?? '')
        return
      }
      if (e.data?.type !== 'html-change') return
      const newHtml = e.data.html as string
      blogBaseHtmlRef.current = newHtml
      // Extract just the body content from the full HTML
      const bodyMatch = newHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      const contentHtml = bodyMatch ? bodyMatch[1].trim() : newHtml
      setSelectedPost(prev => prev ? { ...prev, content_html: contentHtml } : prev)
      if (blogAutoSaveTimer.current) clearTimeout(blogAutoSaveTimer.current)
      blogAutoSaveTimer.current = setTimeout(async () => {
        setBlogSaving('saving')
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) return
        await fetch(`/api/blog-posts/${selectedPost.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content_html: contentHtml }),
        })
        setBlogSaving('saved')
        setTimeout(() => setBlogSaving('idle'), 2000)
      }, 2000)
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

  const saveBlogSidebarBanner = async () => {
    setBlogSidebarBannerSaving('saving')
    const { data: { session: sc } } = await supabase.auth.getSession()
    if (!sc) { setBlogSidebarBannerSaving('idle'); return }
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existingConfig = (proj?.site_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: { ...existingConfig, blog_sidebar_banner: { url: blogSidebarBannerUrl, link: blogSidebarBannerLink } },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setBlogSidebarBannerSaving('saved')
    setTimeout(() => setBlogSidebarBannerSaving('idle'), 2000)
  }

  useEffect(() => {
    if (viewMode === 'code' && activePage) {
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
  const publicUrl = (() => {
    if (!publicBaseUrl) return ''
    if (viewMode === 'blog') {
      if (!selectedPost) return `${publicBaseUrl}/blog`
      const cat = selectedPost.categories?.[0] ? slugify(selectedPost.categories[0]) : null
      return cat
        ? `${publicBaseUrl}/blog/${cat}/${selectedPost.slug}`
        : `${publicBaseUrl}/blog/${selectedPost.slug}`
    }
    // If the preview iframe has navigated internally (e.g. user clicked Blog in nav),
    // reflect that path in the URL bar
    if (viewMode === 'preview' && previewIframePath && previewIframePath !== '/') {
      return `${publicBaseUrl}${previewIframePath}`
    }
    return activeSlug === 'home' ? publicBaseUrl : `${publicBaseUrl}/${activeSlug}`
  })()

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

    // Detect project language: context.language → <html lang="..."> of first page → fallback 'it'
    const detectedLang: string =
      projectContext?.language ||
      latestPagesRef.current[0]?.html?.match(/<html[^>]+lang=["']([^"']{2})/i)?.[1] ||
      'it'

    // Generate SEO metadata for the image in background (non-blocking)
    fetch('/api/generate-image-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, context: { ...projectContext, language: detectedLang } }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(meta => {
        if (!meta) return
        const newMeta = {
          ...mediaMeta,
          [path]: {
            alt: meta.alt ?? '',
            title: meta.title ?? '',
            description: meta.description ?? '',
          },
        }
        setMediaMeta(newMeta)
        saveState(messages, latestPagesRef.current, versions, newMeta)
      })
      .catch(() => { /* silently ignore */ })
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
      loadedPages = loadedPages.map(p => ({ ...p, html: stripEditorArtifacts(p.html) }))
      // Remove any static "blog" page — the blog is served dynamically from blog_posts.
      // A static page with slug "blog" is always shadowed by the dynamic route and causes confusion.
      const hasBlogPage = loadedPages.some(p => p.slug === 'blog')
      loadedPages = loadedPages.filter(p => p.slug !== 'blog')
      // If it had a blog page, make sure the nav link ./blog is still there
      if (hasBlogPage && loadedPages.length > 0 && !hasBlogNavLink(loadedPages)) {
        const lang = (config?.context as { language?: string } | undefined)?.language ?? 'it'
        loadedPages = addBlogLinkToNav(loadedPages, lang === 'es' ? 'Blog' : 'Blog')
      }
      setPages(loadedPages)
      if (loadedPages.length > 0) setActiveSlug(loadedPages[0].slug)
      if (config?.messages) setMessages(config.messages)
      if (config?.versions) setVersions(config.versions)
      if (config?.media) setMediaMeta(config.media)
      if ((config as any)?.favicon_url) setFaviconUrl((config as any).favicon_url as string)
      setBlogHeaderHtml(config?.blog_header_html ?? '')
      setBlogSidebarBannerUrl(config?.blog_sidebar_banner?.url ?? '')
      setBlogSidebarBannerLink(config?.blog_sidebar_banner?.link ?? '')
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
    // Safety guard: never overwrite existing pages with an empty array
    if (!Array.isArray(newPages) || (newPages.length === 0 && latestPagesRef.current.length > 0)) {
      console.warn('saveState: skipping — refusing to overwrite existing pages with empty array')
      return
    }
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
    if (viewMode !== 'blog') return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const meta = session.user.user_metadata ?? {}
        setUserFullName([meta.first_name, meta.last_name].filter(Boolean).join(' ') || session.user.email?.split('@')[0] || '')
      }
    })
    loadBlogPosts()
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

  const saveFaviconUrl = async (url: string) => {
    const { data: proj } = await supabase.from('projects').select('site_config').eq('id', id).single()
    const existing = (proj?.site_config ?? {}) as Record<string, unknown>
    await supabase.from('projects').update({
      site_config: { ...existing, favicon_url: url },
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    setFaviconUrl(url)
  }

  const savePageOgImage = async (slug: string, url: string) => {
    const next = pages.map(p => p.slug === slug ? { ...p, og_image: url } : p)
    setPages(next)
    await saveState(messages, next)
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

  // ── SEO Fix ───────────────────────────────────────────────────────────────────

  /** Fixes a single check on a single page. Returns true on success. */
  const fixOnePage = async (checkId: CheckId, pageSlug: string): Promise<boolean> => {
    const analyses = analyzeAllPages(latestPagesRef.current)
    const pageAnalysis = analyses.find(a => a.pageSlug === pageSlug)
    const checkResult = pageAnalysis?.results.find(r => r.checkId === checkId)
    if (!checkResult) {
      console.error('[SEO Fix] checkResult not found for', checkId, pageSlug)
      setSeoFixError(`Check "${checkId}" non trovato per la pagina "${pageSlug}"`)
      return false
    }

    const resp = await fetch('/api/seo-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        pageSlug,
        checkId,
        checkResult,
        pages: latestPagesRef.current,
        customDomain: customDomain || null,
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
            setSeoAnalyses(analyzeAllPages(updated))
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
        const currentAnalyses = analyzeAllPages(latestPagesRef.current)
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
    const analyses = analyzeAllPages(latestPagesRef.current)
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

    return [html, false]
  }

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

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: id,
        messages: apiMessages,
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
        site_config: { pages, messages: finalMessages, versions, media: mediaMeta },
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
        site_config: { pages, messages: finalMessages, versions, media: mediaMeta },
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
        site_config: { pages, messages: finalMessages, versions, media: mediaMeta },
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      setLoading(false)
      return
    }

    if (result.tool === 'create_site') {
      const rawPages = result.input.pages
      if (!Array.isArray(rawPages)) { markFailed('risposta non valida dal server'); return }
      newPages = rawPages as Page[]
      // Remove any static "blog" page — blog is always served dynamically from blog_posts
      newPages = newPages.filter(p => p.slug !== 'blog')
      const steps = result.steps ? `\n${(result.steps as string[]).join('\n')}` : ''
      summary = `✨ ${result.input.summary}${steps}`
      // Set active to first NEW page (not existing), fallback to first page
      const newSlugs = result.input.newPageSlugs as string[] | undefined
      const firstNew = newSlugs?.find(s => newPages.some(p => p.slug === s))
      newActiveSlug = firstNew ?? (newPages.length > 0 ? newPages[0].slug : activeSlug)

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
      const edits = result.input.edits as { find: string; replace: string }[]
      const failedFinds: string[] = []
      newPages = pages.map(p => {
        if (p.slug !== targetSlug) return p
        let html = p.html
        for (const edit of edits) {
          const [next, applied] = applyEdit(html, edit.find, edit.replace)
          if (applied) html = next
          else { failedFinds.push(edit.find.slice(0, 80)); console.warn('[applyEdit] FAILED find:', edit.find) }
        }
        return { ...p, html }
      })
      summary = `✏️ ${result.input.summary}${failedFinds.length ? ` ⚠️ ${failedFinds.length} edit non applicate` : ''}`
      newActiveSlug = targetSlug
    } else if (result.tool === 'add_page') {
      const newPage: Page = { slug: result.input.slug, name: result.input.name, html: result.input.html }
      if (newPage.slug === 'blog') {
        // Blog is dynamic — never add it as a static page; just ensure nav link exists
        newPages = hasBlogNavLink(pages) ? pages : addBlogLinkToNav(pages, 'Blog')
        summary = `📝 Blog collegato (sistema dinamico attivo)`
        newActiveSlug = activeSlug
      } else {
        newPages = syncNavigation([...pages, newPage], 'add', newPage.slug)
        summary = `➕ ${result.input.summary}`
        newActiveSlug = newPage.slug
      }
    } else if (result.tool === 'delete_page') {
      const targetSlug = result.input.pageSlug as string
      if (targetSlug === 'home') {
        summary = '⚠️ La pagina "home" non può essere eliminata'
      } else {
        const filtered = pages.filter(p => p.slug !== targetSlug)
        newPages = syncNavigation(filtered, 'delete', targetSlug)
        summary = `🗑 ${result.input.summary}`
        if (activeSlug === targetSlug) newActiveSlug = newPages[0]?.slug || 'home'
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
      summary = `🔍 ${result.input.summary}${skipped ? ` (${skipped} edit non applicate)` : ''}`
    } else if (result.tool === 'generate_sitemap') {
      summary = `🗺️ ${result.input.summary}`
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
          // Find an <a>...targetText...</a> inside <nav> and replace its surrounding <li> (or the <a> if no li)
          const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i)
          if (navMatch) {
            const navHtml = navMatch[0]
            const escaped = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const liRe = new RegExp(`<li[^>]*>\\s*<a[^>]*>\\s*${escaped}\\s*<\\/a>\\s*<\\/li>`, 'i')
            const aRe = new RegExp(`<a[^>]*>\\s*${escaped}\\s*<\\/a>`, 'i')
            let newNav: string | null = null
            if (liRe.test(navHtml)) newNav = navHtml.replace(liRe, componentHtml)
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
        ? `🧩 ${result.input.summary} (${injected}/${targetSlugs.length} pagine)`
        : `⚠️ Componente non iniettato — target non trovato in: ${skippedSlugs.join(', ')}`
    } else if (result.tool === 'update_blog_header') {
      const newHeaderHtml = result.input.html as string
      summary = `📝 ${result.input.summary}`
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
    }

    setPages(newPages)
    setActiveSlug(newActiveSlug)
    // Auto-switch to preview so the user sees the result immediately
    if (viewMode !== 'preview') setViewMode('preview')
    // Set scroll target for edits: first replaced text snippet
    if (result.tool === 'edit_page') {
      const firstEdit = (result.input.edits as { find: string; replace: string }[] | undefined)?.[0]
      if (firstEdit?.replace) setScrollTarget(firstEdit.replace.replace(/<[^>]+>/g, '').slice(0, 40).trim())
    }
    setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: summary } : m))
    const finalMessages: Message[] = [...updatedMessages, { id: assistantId, role: 'assistant', content: summary }]
    const newVersions = createVersion(summary.slice(0, 60).replace(/^[✨✏️➕🗑🔍🗺️🎨✍️]\s*/, ''), newPages, versions)
    await saveState(finalMessages, newPages, newVersions)
    setLoading(false)
  }

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
                        // Normal: show final content
                        return stripHtmlFromChat(msg.content, language) || ''
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
                  {pages.map(p => {
                    const urlPath = p.slug === 'home' ? '' : p.slug
                    const isActive = viewMode !== 'blog' && activeSlug === p.slug
                    return (
                      <button key={p.slug} onClick={() => { setActiveSlug(p.slug); if (viewMode === 'blog') setViewMode('preview'); setShowUrlDropdown(false) }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '7px 12px', border: 'none', background: isActive ? '#f0f4ff' : 'transparent',
                          fontSize: '0.75rem', fontFamily: 'monospace', color: isActive ? C.blue : C.text,
                          cursor: 'pointer', fontWeight: 400,
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f4' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                      >
                        /{urlPath}
                      </button>
                    )
                  })}
                  {/* Blog routes */}
                  {blogPosts.length > 0 && (
                    <>
                      <div style={{ height: '1px', background: C.border, margin: '2px 0' }} />
                      <button onClick={() => { setViewMode('blog'); setSelectedPost(null); setShowUrlDropdown(false) }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '7px 12px', border: 'none',
                          background: viewMode === 'blog' && !selectedPost ? '#f0f4ff' : 'transparent',
                          fontSize: '0.75rem', fontFamily: 'monospace',
                          color: viewMode === 'blog' && !selectedPost ? C.blue : C.text,
                          cursor: 'pointer', fontWeight: 400,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f4' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = viewMode === 'blog' && !selectedPost ? '#f0f4ff' : 'transparent' }}
                      >
                        /blog
                      </button>
                      {blogPosts.map(post => {
                        const isSelected = viewMode === 'blog' && selectedPost?.id === post.id
                        const postPath = post.categories?.[0] ? `blog/${slugify(post.categories[0])}/${post.slug}` : `blog/${post.slug}`
                        return (
                          <button key={post.id} onClick={() => { setViewMode('blog'); setSelectedPost(post); setShowUrlDropdown(false) }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: '7px 12px', border: 'none',
                              background: isSelected ? '#f0f4ff' : 'transparent',
                              fontSize: '0.75rem', fontFamily: 'monospace',
                              color: isSelected ? C.blue : C.text,
                              cursor: 'pointer', fontWeight: 400,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#f5f5f4' }}
                            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
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

                {/* ── Main area: grouped checklist ── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                  <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                    {/* Header */}
                    <div style={{ marginBottom: '20px' }}>
                      <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 700, color: C.text }}>SEO Optimizer</h2>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: C.textFaint }}>
                        Analisi live • {SEO_CHECKS.length} check • aggiornata automaticamente
                      </p>
                      {seoFixError && (
                        <div style={{
                          marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
                          background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c',
                          fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                          <span>❌</span>
                          <span style={{ flex: 1 }}>{seoFixError}</span>
                          <button onClick={() => setSeoFixError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: '1rem', padding: 0 }}>✕</button>
                        </div>
                      )}
                    </div>

                    {SEO_GROUPS.map(group => {
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
                            const canFix = result.status !== 'pass'
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
                  </div>
                </div>
              </div>
            )
          })()
        ) : viewMode === 'edit' && activePage ? (
          /* Inline editor v2 — contentEditable inside iframe with sidebar */
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <EditorSidebar
              pages={pages}
              activeSlug={activeSlug}
              onPageSelect={(slug) => setActiveSlug(slug)}
              hasBlog={hasBlogNavLink(pages) || blogPosts.length > 0}
              isBlogActive={false}
              onBlogSelect={() => setViewMode('blog')}
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
              hasBlog={hasBlogNavLink(pages) || blogPosts.length > 0}
              isBlogActive={false}
              onBlogSelect={() => setViewMode('blog')}
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
                      onClick={() => saveFaviconUrl(selectedMedia.url)}
                      style={{
                        width: '100%', padding: '7px 10px',
                        background: selectedMedia.url === faviconUrl ? '#dbeafe' : 'white',
                        border: `1px solid ${selectedMedia.url === faviconUrl ? '#2563eb' : '#e5e7eb'}`,
                        borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600,
                        color: selectedMedia.url === faviconUrl ? '#1d4ed8' : '#374151',
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const,
                        display: 'flex', alignItems: 'center', gap: '6px',
                      }}
                    >
                      {selectedMedia.url === faviconUrl ? '✓ ' : ''} 🌐 Favicon del progetto
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
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) return
              const res = await fetch(`/api/blog-posts/${post.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              const json = await res.json()
              const full: BlogPost = json.post ?? post
              setSelectedPost(full)
              setBlogMetaEdits({})
              // Build editor srcdoc — uses the same CSS as the live blog preview
              const contentHtml = full.content_html ?? ''
              // Extract siteStyle from home page so CSS variables (--color-accent etc.) are inherited
              const homeHtml = pages.find(p => p.slug === 'home')?.html ?? ''
              const siteStyleBlocks = (homeHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n')
              const googleFontsUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lato:ital,wght@0,400;0,700;1,400&family=Roboto:ital,wght@0,400;0,700;1,400&family=Open+Sans:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@400;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:ital,wght@0,400;0,700;1,400&display=swap'
              const editorHtml = `<!DOCTYPE html><html lang="${projectContext.language ?? 'it'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${googleFontsUrl}" rel="stylesheet">${siteStyleBlocks}<style>${BLOG_POST_CONTENT_CSS}</style></head><body><div class="blog-post-wrapper"><div class="blog-post-content" contenteditable="true" data-fact-edit="blog-content" style="outline:none">${contentHtml}</div></div></body></html>`
              setBlogEditorSrcDoc(editorHtml)
              blogBaseHtmlRef.current = editorHtml
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
              await fetch(`/api/blog-posts/${postId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
              if (selectedPost?.id === postId) setSelectedPost(null)
              await loadBlogPosts()
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
              await fetch(`/api/blog-posts/${postId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(updates),
              })
              setSelectedPost(prev => prev ? { ...prev, ...updates } : prev)
              setBlogPosts(prev => prev.map(p => p.id === postId ? { ...p, ...updates } : p))
            }

            const generateWithAI = async () => {
              if (!blogGenTopic.trim()) return
              setBlogGenerating(true)
              const { data: { session } } = await supabase.auth.getSession()
              const token = session?.access_token
              if (!token) { setBlogGenerating(false); return }
              const res = await fetch('/api/generate-blog-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ topic: blogGenTopic, context: projectContext }),
              })
              const json = await res.json()
              if (json.post) {
                const { post: generated } = json
                // Create new post with generated content
                const createRes = await fetch('/api/blog-posts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    projectId: id,
                    title: generated.title,
                    slug: generated.slug,
                    content_html: generated.content_html,
                    excerpt: generated.excerpt,
                    categories: generated.categories ?? [],
                    tags: generated.tags ?? [],
                    seo_title: generated.seo_title,
                    seo_description: generated.seo_description,
                  }),
                })
                const createJson = await createRes.json()
                if (createJson.post) {
                  await loadBlogPosts()
                  openPost(createJson.post)
                }
              }
              setBlogGenerating(false)
              setShowBlogGenPrompt(false)
              setBlogGenTopic('')
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
                    <div style={{ padding: '12px 24px', borderBottom: `1px solid ${C.border}`, background: '#eff6ff', display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: C.blue, flexShrink: 0 }}>✦ Argomento:</span>
                      <input
                        value={blogGenTopic}
                        onChange={e => setBlogGenTopic(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') generateWithAI() }}
                        placeholder="Es: 5 consigli per migliorare il tuo sito web..."
                        autoFocus
                        style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '7px 12px', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button
                        onClick={generateWithAI}
                        disabled={blogGenerating || !blogGenTopic.trim()}
                        style={{ background: blogGenTopic.trim() && !blogGenerating ? C.blue : '#93c5fd', color: 'white', border: 'none', padding: '7px 16px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: blogGenTopic.trim() && !blogGenerating ? 'pointer' : 'not-allowed', fontFamily: 'inherit', flexShrink: 0 }}
                      >{blogGenerating ? '⏳ Generazione...' : 'Genera'}</button>
                      <button onClick={() => { setShowBlogGenPrompt(false); setBlogGenTopic('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textFaint, fontSize: '1.1rem', flexShrink: 0 }}>✕</button>
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
                            placeholder="https://..."
                            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'inherit', background: '#fafaf8', boxSizing: 'border-box' }}
                          />
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: C.textMuted }}>Link di destinazione</label>
                          <input
                            type="text"
                            value={blogSidebarBannerLink}
                            onChange={e => setBlogSidebarBannerLink(e.target.value)}
                            placeholder="https://..."
                            style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: '6px', fontSize: '0.82rem', fontFamily: 'inherit', background: '#fafaf8', boxSizing: 'border-box' }}
                          />
                        </div>
                        {blogSidebarBannerUrl && (
                          <img src={blogSidebarBannerUrl} alt="Banner preview" style={{ width: '100%', maxWidth: '200px', borderRadius: '8px', border: `1px solid ${C.border}` }} />
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            onClick={saveBlogSidebarBanner}
                            disabled={blogSidebarBannerSaving === 'saving'}
                            style={{ background: C.blue, color: 'white', border: 'none', padding: '6px 16px', borderRadius: '7px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                          >{blogSidebarBannerSaving === 'saving' ? '💾 Salvataggio...' : blogSidebarBannerSaving === 'saved' ? '✓ Salvato' : 'Salva'}</button>
                          <span style={{ fontSize: '0.72rem', color: C.textFaint }}>Appare fisso a destra durante la lettura degli articoli</span>
                        </div>
                      </div>
                    )}
                  </div>

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
                    onClick={() => setSelectedPost(null)}
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
                  <a
                    href={`/preview/${projectSlug}/blog/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Preview: /blog/${post.slug}`}
                    style={{ fontSize: '0.72rem', color: C.textFaint, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white }}
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
                      const handleBlogImageUpload = async (file: File) => {
                        if (!file.type.startsWith('image/')) return
                        const { data: { session } } = await supabase.auth.getSession()
                        if (!session) return
                        const ext = file.name.split('.').pop() || 'png'
                        const path = `${session.user.id}/${id}/blog-${Date.now()}.${ext}`
                        const { error } = await supabase.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: false })
                        if (error) return
                        const { data: { publicUrl } } = supabase.storage.from('project-assets').getPublicUrl(path)
                        const imgHtml = `<figure style="margin:1.5rem 0;text-align:center;"><img src="${publicUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;"></figure>`
                        blogIframeRef.current?.contentWindow?.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: imgHtml }, '*')
                      }
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderBottom: `1px solid ${C.border}`, background: C.white, flexShrink: 0, flexWrap: 'wrap' }}>
                          {/* Font picker */}
                          <select
                            title="Scegli font"
                            defaultValue=""
                            onMouseDown={e => e.stopPropagation()}
                            onChange={e => {
                              const font = e.target.value
                              const win = blogIframeRef.current?.contentWindow
                              if (!win || !font) return
                              win.postMessage({ type: 'fact-format', cmd: 'fontName', val: font }, '*')
                              // Reset select to placeholder after applying
                              e.target.value = ''
                            }}
                            style={{
                              height: '26px', padding: '0 4px', border: `1px solid ${C.border}`,
                              borderRadius: 4, background: C.white, cursor: 'pointer',
                              fontSize: '0.75rem', color: C.text, fontFamily: 'inherit',
                              maxWidth: '120px',
                            }}
                          >
                            <option value="" disabled>Font</option>
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
                              <option value="Lato">Lato</option>
                              <option value="Roboto">Roboto</option>
                              <option value="Open Sans">Open Sans</option>
                              <option value="Montserrat">Montserrat</option>
                              <option value="Merriweather">Merriweather</option>
                              <option value="Playfair Display">Playfair Display</option>
                              <option value="Source Serif 4">Source Serif 4</option>
                            </optgroup>
                          </select>
                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />
                          {/* Text color picker */}
                          <label
                            title="Colore testo"
                            style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, height: '26px', gap: '1px', position: 'relative', userSelect: 'none' }}
                          >
                            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: C.text, lineHeight: 1, pointerEvents: 'none' }}>A</span>
                            <div style={{ width: '14px', height: '3px', borderRadius: '1px', background: 'linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7)', pointerEvents: 'none' }} />
                            <input
                              type="color"
                              defaultValue="#000000"
                              onMouseDown={() => {
                                blogIframeRef.current?.contentWindow?.postMessage({ type: 'fact-save-sel' }, '*')
                              }}
                              onChange={e => {
                                const win = blogIframeRef.current?.contentWindow
                                if (!win) return
                                win.postMessage({ type: 'fact-format', cmd: 'foreColor', val: e.target.value }, '*')
                              }}
                              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', border: 'none', padding: 0 }}
                            />
                          </label>
                          <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />
                          {([
                            { label: 'H1', cmd: 'formatBlock', val: 'h1', title: 'Titolo 1', style: { fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, background: blogActiveBlock === 'H1' ? C.blue : C.white, color: blogActiveBlock === 'H1' ? 'white' : C.text, borderColor: blogActiveBlock === 'H1' ? C.blue : C.border } },
                            { label: 'H2', cmd: 'formatBlock', val: 'h2', title: 'Titolo 2', style: { fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, background: blogActiveBlock === 'H2' ? C.blue : C.white, color: blogActiveBlock === 'H2' ? 'white' : C.text, borderColor: blogActiveBlock === 'H2' ? C.blue : C.border } },
                            { label: 'H3', cmd: 'formatBlock', val: 'h3', title: 'Titolo 3', style: { fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, background: blogActiveBlock === 'H3' ? C.blue : C.white, color: blogActiveBlock === 'H3' ? 'white' : C.text, borderColor: blogActiveBlock === 'H3' ? C.blue : C.border } },
                            { label: 'H4', cmd: 'formatBlock', val: 'h4', title: 'Titolo 4', style: { fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, background: blogActiveBlock === 'H4' ? C.blue : C.white, color: blogActiveBlock === 'H4' ? 'white' : C.text, borderColor: blogActiveBlock === 'H4' ? C.blue : C.border } },
                            { label: 'P', cmd: 'formatBlock', val: 'p', title: 'Paragrafo', style: { fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, background: blogActiveBlock === 'P' ? C.blue : C.white, color: blogActiveBlock === 'P' ? 'white' : C.text, borderColor: blogActiveBlock === 'P' ? C.blue : C.border } },
                            null,
                            { label: 'B', cmd: 'bold', val: undefined, title: 'Grassetto', style: { fontWeight: 800, fontSize: '0.82rem' } },
                            { label: 'I', cmd: 'italic', val: undefined, title: 'Corsivo', style: { fontStyle: 'italic', fontSize: '0.82rem' } },
                            { label: 'U', cmd: 'underline', val: undefined, title: 'Sottolineato', style: { textDecoration: 'underline', fontSize: '0.82rem' } },
                            null,
                            { label: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>), cmd: 'link', val: undefined, title: 'Inserisci link', style: { display: 'flex', alignItems: 'center' } },
                            null,
                            { label: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>), cmd: 'insertUnorderedList', val: undefined, title: 'Elenco puntato', style: { display: 'flex', alignItems: 'center' } },
                            { label: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4M3 10h2" strokeWidth="1.5"/><path d="M3 16a1.5 1.5 0 0 1 3 0c0 1.5-3 3-3 3h3" strokeWidth="1.5"/></svg>), cmd: 'insertOrderedList', val: undefined, title: 'Elenco numerato', style: { display: 'flex', alignItems: 'center' } },
                            { label: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>), cmd: 'insertTable', val: undefined, title: 'Inserisci tabella', style: { display: 'flex', alignItems: 'center' } },
                          ] as (null | { label: React.ReactNode; cmd: string; val?: string; title: string; style: React.CSSProperties })[]).map((btn, i) => {
                            if (!btn) return <div key={`sep-${i}`} style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />
                            return (
                              <button
                                key={btn.cmd + (btn.val ?? '')}
                                title={btn.title}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  const win = blogIframeRef.current?.contentWindow
                                  if (!win) return
                                  if (btn.cmd === 'link') {
                                    win.postMessage({ type: 'fact-link' }, '*')
                                  } else if (btn.cmd === 'insertTable') {
                                    const tableHtml = `<table style="width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:0.95rem"><thead><tr><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 1</th><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 2</th><th style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb;text-align:left;font-weight:600">Colonna 3</th></tr></thead><tbody><tr><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 1</td><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 2</td><td style="border:1px solid #d1d5db;padding:8px 12px">Dato 3</td></tr><tr><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 4</td><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 5</td><td style="border:1px solid #d1d5db;padding:8px 12px;background:#f9fafb">Dato 6</td></tr></tbody></table>`
                                    win.postMessage({ type: 'fact-format', cmd: 'insertHTML', val: tableHtml }, '*')
                                  } else {
                                    win.postMessage({ type: 'fact-format', cmd: btn.cmd, val: btn.val }, '*')
                                  }
                                }}
                                style={{
                                  padding: '2px 7px',
                                  border: `1px solid ${C.border}`,
                                  borderRadius: 4,
                                  background: C.white,
                                  cursor: 'pointer',
                                  color: C.text,
                                  lineHeight: 1.4,
                                  ...btn.style,
                                }}
                              >{btn.label}</button>
                            )
                          })}
                          {/* Image upload button */}
                          <div key="sep-img" style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '2px 3px' }} />
                          <button
                            title="Inserisci immagine"
                            onMouseDown={(e) => { e.preventDefault() }}
                            onClick={() => blogImgInputRef.current?.click()}
                            style={{ padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.white, cursor: 'pointer', color: C.text, lineHeight: 1.4, display: 'flex', alignItems: 'center' }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                            </svg>
                          </button>
                          <input
                            ref={el => { blogImgInputRef.current = el }}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handleBlogImageUpload(file)
                              e.target.value = ''
                            }}
                          />
                        </div>
                      )
                    })()}
                    {blogEditorSrcDoc && (
                      <iframe
                        ref={blogIframeRef}
                        srcDoc={blogEditorSrcDoc + `<script id="fact-edit-script">${INLINE_EDIT_SCRIPT}</script>`}
                        style={{ flex: 1, border: 'none', width: '100%', background: 'white' }}
                        title="Blog Editor"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })()
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
            const updatePageField = async (slug: string, field: 'name' | 'menuLabel' | 'inMenu', value: string | boolean) => {
              const next = pages.map(p => p.slug === slug ? { ...p, [field]: value } : p)
              const synced = (field === 'inMenu' || field === 'menuLabel') ? reorderNavLinks(next) : next
              setPages(synced)
              await saveState(messages, synced)
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
                        draggable
                        onDragStart={() => { dragIndexRef.current = idx }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx) }}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null) }}
                        style={{
                          background: C.white,
                          border: `1px solid ${isDragOver ? C.blue : C.border}`,
                          borderRadius: '10px', overflow: 'hidden',
                          boxShadow: isDragOver ? `0 0 0 2px ${C.blue}22` : 'none',
                          transition: 'border-color 0.15s, box-shadow 0.15s',
                          opacity: dragIndexRef.current === idx ? 0.5 : 1,
                        }}
                      >
                        {/* Row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 110px 60px 80px 90px', gap: '0 8px', alignItems: 'center', padding: '10px 12px' }}>
                          {/* Drag handle */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', color: C.textFaint, fontSize: '1rem', userSelect: 'none' }}>
                            ⠿
                          </div>

                          {/* Name */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            <span style={{ fontSize: '0.8rem' }}>📄</span>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.name}</span>
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
                              onClick={() => { setRenamingSlug(isExpanded ? null : page.slug); setRenameValue(page.name) }}
                              title="Impostazioni"
                              style={{ background: isExpanded ? C.blue : C.bg, border: `1px solid ${isExpanded ? C.blue : C.border}`, borderRadius: '6px', padding: '3px 7px', fontSize: '0.72rem', cursor: 'pointer', color: isExpanded ? 'white' : C.text, fontFamily: 'inherit' }}
                            >⚙</button>
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
                            <div style={{ fontSize: '0.7rem', color: '#9b9896', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Scegli immagine OG per questa pagina</div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              {mediaItems.slice(0, 16).map(item => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={item.path}
                                  src={item.url}
                                  alt=""
                                  onClick={() => { savePageOgImage(page.slug, item.url); setOgPickerSlug(null) }}
                                  style={{
                                    width: '48px', height: '32px', objectFit: 'cover',
                                    borderRadius: '4px', cursor: 'pointer',
                                    border: (page as any).og_image === item.url ? '2px solid #2563eb' : '1px solid #e5e7eb',
                                  }}
                                />
                              ))}
                              {(page as any).og_image && (
                                <button
                                  onClick={() => { savePageOgImage(page.slug, ''); setOgPickerSlug(null) }}
                                  style={{ fontSize: '0.68rem', color: '#dc2626', background: 'transparent', border: '1px solid #fecaca', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit' }}
                                >Rimuovi</button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Expanded settings panel */}
                        {isExpanded && (
                          <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 16px', background: '#fafaf9', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            {/* Rename */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Nome pagina</label>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Escape') setRenamingSlug(null) }}
                                  style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none' }}
                                />
                                <button
                                  onClick={async () => {
                                    const trimmed = renameValue.trim()
                                    if (!trimmed) return
                                    await updatePageField(page.slug, 'name', trimmed)
                                    setRenamingSlug(null)
                                  }}
                                  style={{ background: C.blue, color: 'white', border: 'none', borderRadius: '7px', padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                                >✓</button>
                              </div>
                            </div>

                            {/* Menu label */}
                            <div>
                              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: C.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>Etichetta nel menu</label>
                              <input
                                placeholder={page.name}
                                defaultValue={page.menuLabel ?? ''}
                                onBlur={async (e) => {
                                  const v = e.target.value.trim()
                                  await updatePageField(page.slug, 'menuLabel', v || page.name)
                                }}
                                style={{ width: '100%', border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                              />
                              <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: C.textFaint }}>Testo mostrato nella navigazione del sito</p>
                            </div>

                            {/* Open in editor */}
                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => { setActiveSlug(page.slug); setViewMode('edit') }}
                                style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', color: C.text, fontFamily: 'inherit', fontWeight: 500 }}
                              >✎ Apri nell&apos;editor inline</button>
                              <button
                                onClick={() => { setActiveSlug(page.slug); setViewMode('preview') }}
                                style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', color: C.text, fontFamily: 'inherit', fontWeight: 500 }}
                              >🌐 Anteprima</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
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
                  srcDoc={injectBase(activePage.html, projectSlug)}
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
    </main>
  )
}
