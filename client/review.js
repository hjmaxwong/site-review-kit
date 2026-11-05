/* Site Review Kit: Figma-style comments, drawings and highlight boxes on top of a live website.
   Toggle with the floating button (bottom right). Data is stored through a small API (see server/).

   Config (all optional), either as attributes on the <script> tag or as window.SiteReviewConfig
   set before this script loads:
     data-api="/api"                 API base URL. Use a full URL when the API is on another domain.
     data-team="the website team"    Who review mode is for (shown in the passcode prompt).
     data-label="Review"             Text on the floating button.
     data-reveal=".reveal:is-in"     Force scroll-reveal elements visible in review mode:
                                     "<selector>:<class to add>".
     data-css="none"                 Don't auto-load review.css from the script's folder.
   One-tag install from the API host (the API must be at "api" next to review.js):
     <script src="https://review.example.com/review.js" defer></script>
   Events: document fires "sitereview:enter" and "sitereview:exit". */
(() => {
  const tag = document.currentScript;
  const CFG = Object.assign({}, tag ? tag.dataset : {}, window.SiteReviewConfig || {});
  const SRC = tag && tag.src ? new URL(tag.src, location.href) : null;
  const remote = SRC && SRC.origin !== location.origin;
  // Loaded from another domain (the API host)? Then the API is in an "api" folder next to the script.
  const BASE = String(CFG.api || (remote ? new URL('api', SRC).href : '/api')).replace(/\/+$/, '');
  if (SRC && CFG.css !== 'none' && !document.querySelector('link[href*="review.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('review.css', SRC).href; document.head.appendChild(l);
  }
  const API = BASE + '/items';
  const TEAM = CFG.team || 'the website team';
  const LABEL = CFG.label || 'Review';
  const PAGE = (() => {
    let p = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    return p || '/';
  })();
  const COLORS = ['#e5484d', '#f5a524', '#2f7cf6', '#16a34a'];
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} },
  };

  const S = {
    on: false, tool: 'browse', color: ls.get('rv-color') || COLORS[0],
    items: [], all: [], showResolved: false, panel: false, open: null, draft: null, poll: null,
  };
  let fab, ui, layer, svg, marks, bar, panel, pop, preview;

  /* ---------- tiny helpers ---------- */
  const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString();
  };
  const name = () => ls.get('rv-name') || '';
  const I = {
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 014 13.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5" stroke-linecap="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3.5l13 6.2-5.6 1.7-1.7 5.6z"/><path d="M12.4 11.4L19 18" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 21c-.3 0-8-3.6-8-10.5a8 8 0 0116 0C20 17.4 12.3 21 12 21z"/><path d="M8.5 10h7M8.5 13h4" stroke-linecap="round"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.2-4.6L16.5 4.1a2.1 2.1 0 013 3L8.2 18.4z"/><path d="M14.5 6l3.5 3.5"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke-dasharray="3 2.4"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" stroke-linecap="round"/></svg>',
  };

  /* ---------- API ---------- */
  const api = async (method, path = '', body) => {
    const headers = { 'x-review-key': ls.get('rv-key') || '' };
    if (body) headers['content-type'] = 'application/json';
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { ls.set('rv-key', null); const e = new Error('Wrong passcode'); e.status = 401; throw e; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  };

  /* ---------- passcode ---------- */
  const check = async k => {
    try { return (await fetch(BASE + '/auth', { headers: { 'x-review-key': k } })).ok; } catch (_) { return false; }
  };
  async function unlock() {
    const k = ls.get('rv-key');
    if (k && await check(k)) return true;
    ls.set('rv-key', null);
    return askPasscode();
  }
  function askPasscode() {
    return new Promise(resolve => {
      const m = $('div', 'rv-modal rv-ui');
      m.innerHTML = `<form class="rv-modal__card"><h3>Enter review passcode</h3><p>Review mode is for ${esc(TEAM)}. Enter the passcode to view and leave feedback.</p>
        <input name="k" type="password" required placeholder="Passcode" autocomplete="off">
        <p class="rv-err" hidden>That passcode isn’t right. Try again.</p>
        <div class="rv-pop__foot"><button type="button" class="rv-btn rv-btn--ghost" data-act="cancel">Cancel</button><button class="rv-btn">Unlock</button></div></form>`;
      document.body.appendChild(m);
      const input = m.querySelector('input'), err = m.querySelector('.rv-err'), btn = m.querySelector('button:not([type])');
      input.focus();
      m.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        btn.disabled = true; err.hidden = true; btn.textContent = 'Checking…';
        const k = input.value.trim();
        if (await check(k)) { ls.set('rv-key', k); m.remove(); resolve(true); }
        else { err.hidden = false; btn.disabled = false; btn.textContent = 'Unlock'; input.select(); }
      });
      m.querySelector('[data-act=cancel]').addEventListener('click', () => { m.remove(); resolve(false); });
    });
  }
  async function load() {
    try {
      const [items, all] = await Promise.all([api('GET', '?page=' + encodeURIComponent(PAGE)), api('GET', '?all=1')]);
      S.items = items; S.all = all; S.offline = false;
    } catch (e) {
      if (e.status === 401) { exit(); enter(); return; }   // passcode changed: ask again
      S.offline = true;
    }
    render(); renderPanel(); updateBar();
    if (S.open) { const it = S.items.find(i => i.id === S.open); if (it && !pop?.contains(document.activeElement)) openThread(it, true); }
  }

  /* ---------- anchoring ---------- */
  function selectorFor(n) {
    if (!n || n === document.body || n === document.documentElement) return 'body';
    const parts = [];
    while (n && n.nodeType === 1 && n !== document.body) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); return parts.join(' > '); }
      const p = n.parentElement; if (!p) break;
      const same = [...p.children].filter(c => c.tagName === n.tagName);
      parts.unshift(n.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(n) + 1})` : ''));
      n = p;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }
  const docRect = n => { const r = n.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width || 1, h: r.height || 1 }; };
  function targetAt(cx, cy) {
    layer.style.visibility = 'hidden';
    let t = document.elementFromPoint(cx, cy);
    layer.style.visibility = '';
    while (t && (t instanceof SVGElement)) t = t.parentElement;
    if (!t || t.closest('.rv-ui')) t = document.body;
    return t;
  }
  const regionOf = t => t.closest('section, header, footer, main') || document.body;
  const anchorEl = sel => { try { return document.querySelector(sel) || document.body; } catch (_) { return document.body; } };
  const toDoc = (r, f) => ({ x: r.x + f[0] * r.w, y: r.y + f[1] * r.h });
  const toFrac = (r, p) => [(p.x - r.x) / r.w, (p.y - r.y) / r.h];

  /* ---------- UI shell ---------- */
  function buildFab() {
    fab = $('button', 'rv-fab rv-ui');
    fab.type = 'button';
    fab.addEventListener('click', () => (S.on ? exit() : enter()));
    document.body.appendChild(fab);
    paintFab();
  }
  function paintFab() {
    fab.innerHTML = S.on ? `${I.eye}<span>Live view</span>` : `${I.review}<span>${esc(LABEL)}</span>`;
    fab.setAttribute('aria-label', S.on ? 'Exit review mode and return to the live site' : 'Open review mode to comment on this page');
    fab.classList.toggle('is-on', S.on);
  }

  function buildUI() {
    ui = $('div', 'rv-ui rv-root');
    layer = $('div', 'rv-layer');
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('rv-svg');
    marks = $('div', 'rv-marks');
    layer.append(svg, marks);
    document.body.appendChild(layer);

    bar = $('div', 'rv-bar rv-ui');
    bar.innerHTML = `
      <div class="rv-tools" role="toolbar" aria-label="Review tools">
        <button data-tool="browse" aria-label="Browse" data-tip="Browse" data-key="V">${I.cursor}</button>
        <button data-tool="pin" aria-label="Add comment" data-tip="Add comment" data-key="C">${I.pin}</button>
        <button data-tool="draw" aria-label="Draw" data-tip="Draw" data-key="D">${I.pen}</button>
        <button data-tool="box" aria-label="Highlight box" data-tip="Highlight box" data-key="B">${I.box}</button>
      </div>
      <span class="rv-sep"></span>
      <div class="rv-colors">${COLORS.map(c => `<button data-color="${c}" style="--c:${c}" aria-label="Colour" data-tip="Colour"></button>`).join('')}</div>
      <span class="rv-sep"></span>
      <button class="rv-resolved" aria-label="Show resolved" data-tip="Show resolved">${I.check}<span>Resolved</span></button>
      <button class="rv-listbtn" aria-label="All comments" data-tip="All comments">${I.list}<b class="rv-count">0</b></button>
      <button class="rv-name" aria-label="Change your name" data-tip="Change your name">${I.user}<span></span></button>`;
    document.body.appendChild(bar);
    tooltips(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) setTool(b.dataset.tool);
      else if (b.dataset.color) { S.color = b.dataset.color; ls.set('rv-color', S.color); updateBar(); }
      else if (b.classList.contains('rv-resolved')) { S.showResolved = !S.showResolved; render(); renderPanel(); updateBar(); }
      else if (b.classList.contains('rv-listbtn')) { S.panel = !S.panel; panel.classList.toggle('is-open', S.panel); updateBar(); }
      else if (b.classList.contains('rv-name')) askName(true);
    });

    panel = $('aside', 'rv-panel rv-ui');
    document.body.appendChild(panel);

    hint = $('div', 'rv-hint rv-ui');
    document.body.appendChild(hint);

    layer.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', schedule);
    window.addEventListener('keydown', onKey);
    ro = new ResizeObserver(schedule); ro.observe(document.body);
    updateBar();
  }
  let hint, ro, raf;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); if (pop && S.open) placePop(); }); };

  function updateBar() {
    if (!bar) return;
    bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.tool === S.tool));
    bar.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('is-active', b.dataset.color === S.color));
    bar.querySelector('.rv-resolved').classList.toggle('is-active', S.showResolved);
    bar.querySelector('.rv-listbtn').classList.toggle('is-active', S.panel);
    bar.querySelector('.rv-count').textContent = S.items.filter(i => !i.resolved).length;
    bar.querySelector('.rv-name span').textContent = name() || 'Your name';
    layer.classList.toggle('is-tool', S.tool !== 'browse');
    layer.dataset.tool = S.tool;
    const tips = { browse: '', pin: 'Click anywhere to leave a comment', draw: 'Drag to draw, then add a note', box: 'Drag to highlight an area, then add a note' };
    hint.textContent = S.offline ? 'Can’t reach the comment server. Comments will not be saved.' : tips[S.tool];
    hint.classList.toggle('is-show', !!hint.textContent);
    hint.classList.toggle('is-warn', !!S.offline);
  }
  function setTool(t) { S.tool = t; closePop(); updateBar(); }

  /* ---------- render markers + drawings ---------- */
  const visible = () => S.items.filter(i => S.showResolved || !i.resolved);
  const numberOf = it => S.items.indexOf(it) + 1;
  function render() {
    if (!layer) return;
    const W = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    layer.style.width = W + 'px'; layer.style.height = H + 'px';
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = ''; marks.innerHTML = '';
    for (const it of visible()) {
      const r = docRect(anchorEl(it.anchor.sel));
      let at;
      if (it.type === 'pin') {
        at = toDoc(r, [it.anchor.fx, it.anchor.fy]);
      } else if (it.type === 'draw' && it.points.length > 1) {
        const pts = it.points.map(f => toDoc(r, f));
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', 'M' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L'));
        path.setAttribute('class', 'rv-stroke' + (it.resolved ? ' is-resolved' : ''));
        path.style.stroke = it.color;
        path.addEventListener('click', () => openThread(it));
        svg.appendChild(path);
        at = pts[0];
      } else if (it.type === 'box' && it.points.length === 2) {
        const [a, b] = it.points.map(f => toDoc(r, f));
        const rect = document.createElementNS(svg.namespaceURI, 'rect');
        rect.setAttribute('x', Math.min(a.x, b.x)); rect.setAttribute('y', Math.min(a.y, b.y));
        rect.setAttribute('width', Math.abs(b.x - a.x)); rect.setAttribute('height', Math.abs(b.y - a.y));
        rect.setAttribute('rx', 6);
        rect.setAttribute('class', 'rv-rect' + (it.resolved ? ' is-resolved' : ''));
        rect.style.stroke = it.color; rect.style.fill = it.color;
        rect.addEventListener('click', () => openThread(it));
        svg.appendChild(rect);
        at = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
      } else continue;
      const m = $('button', 'rv-mark' + (it.type === 'pin' ? ' is-pin' : '') + (it.resolved ? ' is-resolved' : '') + (S.open === it.id ? ' is-open' : ''));
      m.style.left = at.x + 'px'; m.style.top = at.y + 'px'; m.style.setProperty('--c', it.color);
      m.innerHTML = `<span>${numberOf(it)}</span>`;
      m.title = `${it.author}: ${it.text || '(no note)'}`;
      m.addEventListener('click', e => { e.stopPropagation(); openThread(it); });
      marks.appendChild(m);
    }
    if (S.draft) drawDraft();
  }

  /* ---------- creating ---------- */
  function onDown(e) {
    if (S.tool === 'browse' || e.button > 0) return;
    if (e.target.closest('.rv-mark, .rv-pop')) return;
    e.preventDefault();
    closePop();
    const start = { x: e.pageX, y: e.pageY };
    const target = targetAt(e.clientX, e.clientY);

    if (S.tool === 'pin') {
      const r = docRect(target);
      S.draft = { type: 'pin', anchorEl: target, anchor: { sel: selectorFor(target), ...fracObj(toFrac(r, start)) }, points: [], at: start };
      render(); compose(start);
      return;
    }
    const region = regionOf(target);
    const pts = [start];
    S.draft = { type: S.tool, anchorEl: region, pts };
    layer.setPointerCapture(e.pointerId);
    const move = ev => {
      const p = { x: ev.pageX, y: ev.pageY };
      if (S.tool === 'draw') { const l = pts[pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 2) pts.push(p); }
      else pts[1] = p;
      drawDraft();
    };
    const up = () => {
      layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up);
      const ok = S.tool === 'draw' ? pts.length > 2 : pts[1] && Math.abs(pts[1].x - pts[0].x) > 8 && Math.abs(pts[1].y - pts[0].y) > 8;
      if (!ok) { S.draft = null; render(); return; }
      const r = docRect(region);
      S.draft.anchor = { sel: selectorFor(region), fx: 0, fy: 0 };
      S.draft.points = pts.map(p => toFrac(r, p));
      const end = S.tool === 'box' ? { x: Math.max(pts[0].x, pts[1].x), y: Math.max(pts[0].y, pts[1].y) } : pts[pts.length - 1];
      compose(end);
    };
    layer.addEventListener('pointermove', move); layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
  }
  const fracObj = f => ({ fx: f[0], fy: f[1] });
  function drawDraft() {
    preview?.remove(); preview = null;
    const d = S.draft; if (!d) return;
    if (d.type === 'pin') {
      preview = $('div', 'rv-mark is-pin is-draft'); preview.style.left = d.at.x + 'px'; preview.style.top = d.at.y + 'px';
      preview.style.setProperty('--c', S.color); preview.innerHTML = '<span>+</span>'; marks.appendChild(preview); return;
    }
    const pts = d.pts;
    if (d.type === 'draw') {
      preview = document.createElementNS(svg.namespaceURI, 'path');
      preview.setAttribute('d', 'M' + pts.map(p => `${p.x} ${p.y}`).join(' L'));
      preview.setAttribute('class', 'rv-stroke'); preview.style.stroke = S.color;
    } else if (pts[1]) {
      preview = document.createElementNS(svg.namespaceURI, 'rect');
      preview.setAttribute('x', Math.min(pts[0].x, pts[1].x)); preview.setAttribute('y', Math.min(pts[0].y, pts[1].y));
      preview.setAttribute('width', Math.abs(pts[1].x - pts[0].x)); preview.setAttribute('height', Math.abs(pts[1].y - pts[0].y));
      preview.setAttribute('rx', 6); preview.setAttribute('class', 'rv-rect'); preview.style.stroke = S.color; preview.style.fill = S.color;
    }
    if (preview) svg.appendChild(preview);
  }

  async function compose(at) {
    if (!name()) { const n = await askName(); if (!n) { S.draft = null; render(); return; } }
    pop = $('div', 'rv-pop rv-ui is-new');
    pop.innerHTML = `
      <div class="rv-pop__head"><span class="rv-avatar" style="--c:${S.color}">${esc(name()[0] || '?')}</span><b>${esc(name())}</b></div>
      <textarea placeholder="${S.draft.type === 'pin' ? 'What should change here?' : 'Add a note about this (optional)'}" rows="3"></textarea>
      <div class="rv-pop__foot"><span>Ctrl + Enter to post</span><button class="rv-btn rv-btn--ghost" data-act="cancel">Cancel</button><button class="rv-btn" data-act="save">Post</button></div>`;
    pop.style.left = at.x + 'px'; pop.style.top = at.y + 'px';
    layer.appendChild(pop);
    keepInView(pop);
    const ta = pop.querySelector('textarea'); ta.focus({ preventScroll: true });
    const save = async () => {
      const text = ta.value.trim();
      if (S.draft.type === 'pin' && !text) { ta.focus(); ta.classList.add('is-err'); return; }
      const d = S.draft;
      const item = { type: d.type, anchor: d.anchor, points: d.points || [], color: S.color, text, author: name(), vw: innerWidth };
      const saveBtn = pop.querySelector('[data-act=save]'), saveLabel = saveBtn.textContent;
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        const saved = await api('POST', '', { page: PAGE, item });
        S.items.push(saved); S.all.push(saved);
        S.draft = null; closePop(); render(); renderPanel(); updateBar();
        if (S.tool === 'pin') setTool('browse');
      } catch (err) { alert('Could not save: ' + err.message); saveBtn.disabled = false; saveBtn.textContent = saveLabel; }
    };
    pop.addEventListener('click', e => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'cancel') { S.draft = null; closePop(); render(); }
      if (a === 'save') save();
    });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); });
  }

  /* ---------- threads ---------- */
  function openThread(it, refresh) {
    if (!refresh) closePop();
    else pop?.remove();
    S.open = it.id;
    pop = $('div', 'rv-pop rv-pop--thread rv-ui' + (refresh ? '' : ' is-new'));
    const replies = (it.replies || []).map(r => `<div class="rv-msg"><span class="rv-avatar">${esc(r.author[0])}</span><div><p class="rv-meta"><b>${esc(r.author)}</b> · ${ago(r.created)}</p><p>${esc(r.text)}</p></div></div>`).join('');
    pop.innerHTML = `
      <div class="rv-pop__bar"><span class="rv-num" style="--c:${it.color}">${numberOf(it)}</span><span class="rv-type">${{ pin: 'Comment', draw: 'Drawing', box: 'Highlight' }[it.type]}</span>
        <button class="rv-icon" data-act="resolve" title="${it.resolved ? 'Reopen' : 'Resolve'}">${I.check}</button>
        <button class="rv-icon" data-act="delete" title="Delete">${I.trash}</button>
        <button class="rv-icon" data-act="close" title="Close">${I.x}</button></div>
      ${it.resolved ? '<p class="rv-flag">Resolved</p>' : ''}
      <div class="rv-msgs">
        <div class="rv-msg"><span class="rv-avatar" style="--c:${it.color}">${esc(it.author[0])}</span><div><p class="rv-meta"><b>${esc(it.author)}</b> · ${ago(it.created)}${it.vw ? ` · at ${it.vw}px wide` : ''}</p><p>${esc(it.text) || '<i>No note</i>'}</p></div></div>
        ${replies}
      </div>
      <div class="rv-reply"><textarea rows="1" placeholder="Reply"></textarea><button class="rv-btn" data-act="reply">Reply</button></div>`;
    layer.appendChild(pop);
    placePop();
    if (!refresh) keepInView(pop);
    render(); renderPanel();
    const ta = pop.querySelector('textarea');
    if (!refresh && matchMedia('(pointer: fine)').matches) ta.focus({ preventScroll: true });
    const reply = async () => {
      const text = ta.value.trim(); if (!text) return;
      if (!name() && !(await askName())) return;
      try { Object.assign(it, await api('PATCH', '/' + it.id, { reply: { author: name(), text } })); openThread(it, true); renderPanel(); }
      catch (err) { alert('Could not reply: ' + err.message); }
    };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(); } });
    pop.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
      if (a === 'close') closePop();
      if (a === 'reply') reply();
      if (a === 'resolve') {
        Object.assign(it, await api('PATCH', '/' + it.id, { resolved: !it.resolved }));
        if (it.resolved && !S.showResolved) closePop(); else openThread(it, true);
        render(); renderPanel(); updateBar();
      }
      if (a === 'delete' && confirm('Delete this ' + ({ pin: 'comment', draw: 'drawing', box: 'highlight' }[it.type]) + ' for everyone?')) {
        await api('DELETE', '/' + it.id);
        S.items = S.items.filter(i => i !== it); S.all = S.all.filter(i => i.id !== it.id);
        closePop(); render(); renderPanel(); updateBar();
      }
    });
  }
  function placePop() {
    const it = S.items.find(i => i.id === S.open); if (!it || !pop) return;
    const m = [...marks.children].find(x => x.title && x.querySelector('span')?.textContent == numberOf(it));
    if (m) { pop.style.left = (parseFloat(m.style.left) + 22) + 'px'; pop.style.top = (parseFloat(m.style.top) - 10) + 'px'; }
  }
  function keepInView(el) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 12) el.style.left = (parseFloat(el.style.left) - (r.right - innerWidth + 24)) + 'px';
    if (r.top < 80 || r.bottom > innerHeight - 90) scrollTo({ top: scrollY + r.top - innerHeight / 3, behavior: 'smooth' });
  }
  function closePop() {
    pop?.remove(); pop = null;
    if (S.open) { S.open = null; render(); renderPanel(); }
    if (S.draft) { S.draft = null; render(); }
  }

  /* ---------- side panel ---------- */
  function renderPanel() {
    if (!panel) return;
    const list = visible();
    const others = {};
    S.all.filter(i => i.page !== PAGE && !i.resolved).forEach(i => (others[i.page] = (others[i.page] || 0) + 1));
    const label = p => p === '/' ? 'Home' : p.replace(/^\//, '').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
    panel.innerHTML = `
      <div class="rv-panel__head"><b>Feedback on this page</b><span>${S.items.filter(i => !i.resolved).length} open · ${S.items.filter(i => i.resolved).length} resolved</span>
        <button class="rv-icon" data-act="close" title="Close">${I.x}</button></div>
      <div class="rv-panel__list">${list.length ? list.map(it => `
        <button class="rv-row${it.resolved ? ' is-resolved' : ''}${S.open === it.id ? ' is-open' : ''}" data-id="${it.id}">
          <span class="rv-num" style="--c:${it.color}">${numberOf(it)}</span>
          <span class="rv-row__body"><span class="rv-meta"><b>${esc(it.author)}</b> · ${ago(it.created)}${(it.replies || []).length ? ` · ${(it.replies || []).length} repl${it.replies.length > 1 ? 'ies' : 'y'}` : ''}</span>
          <span class="rv-row__text">${esc(it.text) || '<i>' + ({ draw: 'Drawing', box: 'Highlight' }[it.type] || '') + ' without a note</i>'}</span></span>
        </button>`).join('') : `<p class="rv-empty">No ${S.showResolved ? '' : 'open '}feedback here yet. Pick a tool in the toolbar to add some.</p>`}</div>
      ${Object.keys(others).length ? `<div class="rv-panel__others"><p>Other pages</p>${Object.entries(others).map(([p, n]) =>
        `<a href="${p === '/' ? '/' : p}">${esc(label(p))}<span>${n}</span></a>`).join('')}</div>` : ''}
      ${S.all.length ? `<div class="rv-panel__foot"><button class="rv-btn rv-btn--ghost" data-act="csv">Download all feedback (CSV)</button></div>` : ''}`;
    panel.onclick = e => {
      if (e.target.closest('[data-act=close]')) { S.panel = false; panel.classList.remove('is-open'); updateBar(); return; }
      if (e.target.closest('[data-act=csv]')) { downloadCsv(); return; }
      const row = e.target.closest('.rv-row'); if (!row) return;
      const it = S.items.find(i => i.id === row.dataset.id); if (it) openThread(it);
    };
  }

  function downloadCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['page', 'number', 'type', 'status', 'author', 'created', 'comment', 'replies', 'screen width', 'link']];
    const byPage = {};
    S.all.forEach(i => (byPage[i.page] = byPage[i.page] || []).push(i));
    Object.entries(byPage).forEach(([p, list]) => list.forEach((i, n) => rows.push([
      p, n + 1, i.type, i.resolved ? 'resolved' : 'open', i.author, new Date(i.created).toISOString(), i.text,
      (i.replies || []).map(r => r.author + ': ' + r.text).join(' | '), i.vw, location.origin + p + '?review=1',
    ])));
    const BOM = String.fromCharCode(0xFEFF), CRLF = String.fromCharCode(13, 10);
    const blob = new Blob([BOM + rows.map(r => r.map(q).join(',')).join(CRLF)], { type: 'text/csv' });
    const a = $('a'); a.href = URL.createObjectURL(blob); a.download = 'feedback-' + location.hostname + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- tooltips ---------- */
  // First tooltip waits 400ms; moving to a neighbour within 300ms shows it instantly, no animation.
  function tooltips(root) {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelector('.rv-tip')?.remove();
    if (tooltips.onScroll) removeEventListener('scroll', tooltips.onScroll);
    const tip = $('div', 'rv-tip rv-ui'); tip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tip);
    let timer = 0, warmUntil = 0;
    const show = b => {
      const r = b.getBoundingClientRect();
      tip.innerHTML = esc(b.dataset.tip) + (b.dataset.key ? `<kbd>${b.dataset.key}</kbd>` : '');
      tip.style.left = r.left + r.width / 2 + 'px'; tip.style.top = r.top - 36 + 'px';
      tip.classList.add('is-show');
    };
    const hide = () => { clearTimeout(timer); if (tip.classList.contains('is-show')) warmUntil = Date.now() + 300; tip.classList.remove('is-show'); };
    root.addEventListener('pointerover', e => {
      const b = e.target.closest('[data-tip]'); if (!b) return;
      clearTimeout(timer);
      const warm = tip.classList.contains('is-show') || Date.now() < warmUntil;
      tip.classList.toggle('is-instant', warm);
      if (warm) show(b); else timer = setTimeout(() => show(b), 400);
    });
    root.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) hide(); });
    root.addEventListener('pointerdown', () => { clearTimeout(timer); tip.classList.remove('is-show'); });
    tooltips.onScroll = hide;
    addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- name ---------- */
  function askName(force) {
    return new Promise(resolve => {
      if (name() && !force) return resolve(name());
      const m = $('div', 'rv-modal rv-ui');
      m.innerHTML = `<form class="rv-modal__card"><h3>Who’s reviewing?</h3><p>Your name appears next to your comments so the team knows who left them.</p>
        <input name="n" required maxlength="60" placeholder="Your name" value="${esc(name())}" autocomplete="name">
        <div class="rv-pop__foot"><button type="button" class="rv-btn rv-btn--ghost" data-act="cancel">Cancel</button><button class="rv-btn">Continue</button></div></form>`;
      document.body.appendChild(m);
      const input = m.querySelector('input'); input.focus();
      m.querySelector('form').addEventListener('submit', e => { e.preventDefault(); ls.set('rv-name', input.value.trim()); m.remove(); updateBar(); resolve(name()); });
      m.querySelector('[data-act=cancel]').addEventListener('click', () => { m.remove(); resolve(name() || null); });
    });
  }

  /* ---------- keyboard ---------- */
  function onKey(e) {
    if (!S.on) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') { if (pop) closePop(); else setTool('browse'); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { v: 'browse', c: 'pin', d: 'draw', b: 'box' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  }

  /* ---------- mode switching ---------- */
  function setUrl(on) {
    const u = new URL(location.href);
    on ? u.searchParams.set('review', '1') : u.searchParams.delete('review');
    history.replaceState(null, '', u);
  }
  async function enter() {
    if (S.on || S.entering) return;
    S.entering = true;
    const ok = await unlock();
    S.entering = false;
    if (!ok) { ls.set('rv-mode', null); setUrl(false); return; }
    S.on = true; ls.set('rv-mode', '1'); setUrl(true);
    document.documentElement.classList.add('rv-on');
    if (CFG.reveal) { const [sel, cls] = String(CFG.reveal).split(':'); try { document.querySelectorAll(sel).forEach(el => el.classList.add(cls || 'is-in')); } catch (_) {} }
    document.dispatchEvent(new CustomEvent('sitereview:enter'));
    buildUI(); paintFab(); load();
    S.poll = setInterval(() => { if (!document.hidden && !S.draft) load(); }, 15000);
    if (!name()) askName();
  }
  function exit() {
    S.on = false; ls.set('rv-mode', null); setUrl(false);
    clearInterval(S.poll); ro?.disconnect();
    window.removeEventListener('resize', schedule); window.removeEventListener('keydown', onKey);
    [layer, bar, panel, hint, pop, document.querySelector('.rv-tip')].forEach(x => x?.remove());
    layer = bar = panel = hint = pop = null; S.open = null; S.draft = null; S.tool = 'browse'; S.panel = false;
    document.documentElement.classList.remove('rv-on');
    document.dispatchEvent(new CustomEvent('sitereview:exit'));
    paintFab();
  }

  const start = () => {
    buildFab();
    const q = new URLSearchParams(location.search);
    if (q.get('review') === '0') ls.set('rv-mode', null);
    else if (q.has('review') || ls.get('rv-mode')) enter();
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
