/*! CommentLayer — drop-a-pin review comments for any site. Source: packages/commentlayer (Summit ML). */
'use strict';
(() => {
  if (location.protocol === 'file:') return;
  const script = document.currentScript;
  const scriptApi = script && script.dataset.api;

function init(cfg) {
  if (document.querySelector('.cl-bar')) return;
  const BASE = (scriptApi || cfg.api || '/api/commentlayer').replace(/\/$/, '');
  const API = BASE + '/comments';
  const VERSIONS = BASE + '/versions';
  const doFetch = cfg.fetch || ((url, init) => fetch(url, init));
  const pageKey = () => (cfg.scopeHost ? location.host : '') + (location.pathname.replace(/\/+$/, '') || '/');
  let page = pageKey();
  const ls = cfg.storage || {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
  };
  const token = ls.get('cl-token') || (() => { const t = crypto.randomUUID(); ls.set('cl-token', t); return t; })();
  const adminMatch = location.hash.match(/^#cl-admin=(.+)$/);
  if (adminMatch) { ls.set('cl-admin', decodeURIComponent(adminMatch[1])); history.replaceState(null, '', location.pathname); }
  const admin = ls.get('cl-admin') || '';
  let name = ls.get('cl-name') || '';
  let mode = ss.get('cl-mode') === 'on';
  let comments = [];
  let all = [];
  let versions = [];
  let currentVersion = '';
  let view = ss.get('cl-version') || '';
  let activePop = null;
  const roundLabel = id => (versions.find(v => v.id === id) || {}).label || id;
  const viewingOld = () => view && view !== currentVersion;
  function setView(id) {
    view = id;
    ss.set('cl-version', id);
    comments = all.filter(c => c.page === page && c.version === view);
    closePop();
    renderBar();
    renderPins();
  }

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach(c => node.append(c));
    return node;
  };
  const api = async (method, url, body) => {
    const headers = { 'Content-Type': 'application/json', 'X-Comment-Token': token };
    if (admin) headers['X-Comment-Admin'] = admin;
    const res = await doFetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };
  // ── theme: custom (per site) > host config > host site custom properties > defaults ──
  const THEME_KEYS = ['primary', 'secondary', 'tertiary'];
  const THEME_LABELS = { primary: 'Primary', secondary: 'Background', tertiary: 'Text' };
  const THEME_DEFAULTS = { primary: '#c94a8f', secondary: '#1f1c1f', tertiary: '' };
  const SITE_PROPS = {
    primary: ['--primary-color', '--color-primary', '--primary', '--brand-color', '--brand', '--accent-color', '--color-accent', '--accent'],
    secondary: ['--secondary-color', '--color-secondary', '--secondary'],
    tertiary: ['--tertiary-color', '--color-tertiary', '--tertiary']
  };
  const themeKey = () => 'cl-theme' + (cfg.scopeHost ? ':' + location.host : '');
  const isColor = v => typeof v === 'string' && v.trim() !== '' && CSS.supports('color', v.trim());
  const rgbOf = v => {
    const probe = document.createElement('span');
    probe.style.color = v;
    document.body.append(probe);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
    probe.remove();
    return m.slice(0, 3).map(Number);
  };
  const toHex = v => '#' + rgbOf(v).map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
  const contrastOn = v => { const [r, g, b] = rgbOf(v); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#1f1c1f' : '#ffffff'; };
  function themeSources() {
    const root = getComputedStyle(document.documentElement);
    let custom = {};
    try { custom = JSON.parse(ls.get(themeKey()) || '{}') || {}; } catch {}
    return THEME_KEYS.map(k => {
      const fromConfig = (script && script.dataset[k]) || (cfg.theme && cfg.theme[k]) || '';
      const fromSite = SITE_PROPS[k].map(n => root.getPropertyValue(n).trim()).find(isColor) || '';
      return { key: k, custom: isColor(custom[k]) ? custom[k].trim() : '', config: isColor(fromConfig) ? fromConfig.trim() : '', site: fromSite };
    });
  }
  const resolvedTheme = () => {
    const v = {};
    themeSources().forEach(t => { v[t.key] = t.custom || t.config || t.site || THEME_DEFAULTS[t.key]; });
    if (!v.tertiary) v.tertiary = contrastOn(v.secondary);
    return v;
  };
  function applyTheme() {
    const v = resolvedTheme();
    let style = document.getElementById('cl-theme');
    if (!style) { style = document.createElement('style'); style.id = 'cl-theme'; document.head.append(style); }
    style.textContent = `.cl-ui.cl-ui{--cl-primary:${v.primary};--cl-secondary:${v.secondary};--cl-tertiary:${v.tertiary};--cl-accent-fg:${contrastOn(v.primary)}}`;
  }
  function saveTheme(values) {
    const clean = {};
    THEME_KEYS.forEach(k => { if (isColor(values[k])) clean[k] = values[k].trim(); });
    ls.set(themeKey(), Object.keys(clean).length ? JSON.stringify(clean) : '');
    applyTheme();
  }
  let themeOpen = false;
  // ── holidays: the status dot becomes a small icon on the day ──────────────────
  const HOLIDAY_ICONS = {
    halloween: '<path d="M11 3h2v4h-2z"/><path d="M8 7c-3.3 0-6 3.1-6 7s2.7 7 6 7c1.5 0 2.9-.5 4-1.4 1.1.9 2.5 1.4 4 1.4 3.3 0 6-3.1 6-7s-2.7-7-6-7c-1.5 0-2.9.5-4 1.4C10.9 7.5 9.5 7 8 7z"/><path d="M9.2 8.6c-1.1 2.2-1.1 8.6 0 10.8M14.8 8.6c1.1 2.2 1.1 8.6 0 10.8" stroke="var(--cl-bg)" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
    valentines: '<path d="M12 21s-7.5-4.6-9.6-9.3C1 8.6 3.2 5 6.6 5c2 0 3.6 1 4.4 2.4C11.8 6 13.4 5 15.4 5c3.4 0 5.6 3.6 4.2 6.7C19.5 16.4 12 21 12 21z"/>',
    stpatricks: '<circle cx="12" cy="7" r="3.6"/><circle cx="7.2" cy="12.2" r="3.6"/><circle cx="16.8" cy="12.2" r="3.6"/><path d="M11 14h2l.6 7h-3.2z"/>',
    july4: '<path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.8L5.7 21l1.7-7L2 9.2l7.1-.6z"/>',
    thanksgiving: '<path d="M3 14.5a9 9 0 0 1 18 0z"/><circle cx="3.8" cy="10.7" r="2.5"/><circle cx="7.2" cy="6.9" r="2.5"/><circle cx="12" cy="5.5" r="2.5"/><circle cx="16.8" cy="6.9" r="2.5"/><circle cx="20.2" cy="10.7" r="2.5"/><path d="M9.8 12.5L4.9 8.1M11.2 11.6L9.4 5.4M12.8 11.6l1.8-6.2M14.2 12.5l4.9-4.4" stroke="var(--cl-bg)" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="12.8" cy="17.3" rx="5.4" ry="4.2"/><circle cx="5.4" cy="14.6" r="2.5"/><path d="M3.2 13.8l-2.6 1 2.6 1z"/>',
    christmas: '<path d="M12 2l4.5 6.5h-2.6l3.8 5h-2.5l3.8 5.5H5l3.8-5.5H6.3l3.8-5H7.5z"/><path d="M10.5 19h3v3h-3z"/>',
    newyear: '<path d="M12 1.5l2.2 7.3 7.3 2.2-7.3 2.2L12 20.5l-2.2-7.3-7.3-2.2 7.3-2.2z"/>'
  };
  const nthWeekday = (year, month, weekday, n) => { const d = new Date(year, month, 1); const offset = (weekday - d.getDay() + 7) % 7; return 1 + offset + (n - 1) * 7; };
  function holidayFor(date) {
    const m = date.getMonth(), d = date.getDate(), y = date.getFullYear();
    if (m === 9 && d >= 30) return 'halloween';
    if (m === 1 && d === 14) return 'valentines';
    if (m === 2 && d === 17) return 'stpatricks';
    if (m === 6 && d === 4) return 'july4';
    if (m === 10 && d === nthWeekday(y, 10, 4, 4)) return 'thanksgiving';
    if (m === 11 && (d === 24 || d === 25)) return 'christmas';
    if ((m === 11 && d === 31) || (m === 0 && d === 1)) return 'newyear';
    return '';
  }
  const holidaySetting = (script && script.dataset.holiday) || (cfg.holiday !== undefined ? String(cfg.holiday) : '');
  const holiday = holidaySetting === 'off' ? '' : HOLIDAY_ICONS[holidaySetting] ? holidaySetting : holidayFor(new Date());
  function statusDot() {
    if (!holiday) return el('span', { class: 'cl-dot' });
    const dot = el('span', { class: 'cl-dot cl-dot-icon', title: 'Happy ' + ({ halloween: 'Halloween', valentines: "Valentine's Day", stpatricks: "St. Patrick's Day", july4: 'Fourth of July', thanksgiving: 'Thanksgiving', christmas: 'holidays', newyear: 'New Year' })[holiday] + ' from CommentLayer' });
    dot.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + HOLIDAY_ICONS[holiday] + '</svg>';
    return dot;
  }

  const when = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const pageLabel = p => p === '/' ? 'Home' : (p.replace(/^\//, '').split('/').filter(Boolean).map(s => s.replace(/-/g, ' ')).join(' / ') || 'Home').replace(/^\w/, c => c.toUpperCase());
  let toastTimer;
  const toast = msg => {
    document.querySelectorAll('.cl-toast').forEach(t => t.remove());
    const t = el('div', { class: 'cl-toast cl-ui', text: msg });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2400);
  };

  const pathFor = node => {
    if (!node || node === document.body || node === document.documentElement) return 'body';
    if (node.id) return '#' + CSS.escape(node.id);
    const parent = node.parentElement;
    const index = Array.from(parent.children).filter(c => c.tagName === node.tagName).indexOf(node) + 1;
    return pathFor(parent) + '>' + node.tagName.toLowerCase() + ':nth-of-type(' + index + ')';
  };
  const anchorFor = target => {
    let node = target instanceof Element ? target : target.parentElement;
    while (node && (node.namespaceURI === 'http://www.w3.org/2000/svg' || node.classList.contains('cl-ui'))) node = node.parentElement;
    return node || document.body;
  };
  const resolvePoint = c => {
    let node = null;
    try { node = document.querySelector(c.selector); } catch {}
    if (node) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { left: r.left + window.scrollX + c.x * r.width, top: r.top + window.scrollY + c.y * r.height };
    }
    return { left: c.px || 0, top: c.py || 0 };
  };

  const bar = el('div', { class: 'cl-bar cl-ui' });
  const layer = el('div', { class: 'cl-layer cl-ui' });
  const goo = el('div', { class: 'cl-goo', 'aria-hidden': 'true' }, [el('span', { class: 'cl-goo-panel' }), el('span', { class: 'cl-goo-tab' })]);
  document.body.append(bar, layer);
  if (!document.getElementById('cl-goo-filter')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<filter id="cl-goo-filter"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter>';
    document.body.append(svg);
  }
  const sizer = new ResizeObserver(entries => {
    entries.forEach(e => {
      const t = e.target;
      if (t.classList.contains('cl-tab')) bar.style.setProperty('--cl-tab-w', t.offsetWidth + 'px');
      else { bar.style.setProperty('--cl-panel-w', t.offsetWidth + 'px'); bar.style.setProperty('--cl-panel-h', t.offsetHeight + 'px'); }
    });
  });
  function mountDock(panel, tab) {
    bar.append(goo, panel, tab);
    sizer.disconnect();
    sizer.observe(panel);
    sizer.observe(tab);
  }

  function renderBar() {
    bar.replaceChildren();
    const here = comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const open = here.filter(c => !c.resolved).length;
    bar.dataset.on = mode ? 'true' : 'false';

    const head = el('div', { class: 'cl-head' });
    if (mode && !name) {
      const input = el('input', { type: 'text', placeholder: 'Your name', maxlength: '80', 'aria-label': 'Your name' });
      const form = el('form', { class: 'cl-name-form', onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (!v) return; name = v; ls.set('cl-name', v); bar.classList.remove('is-open'); renderBar(); toast('Click anywhere on the page to leave a comment.'); } }, [
        input, el('button', { class: 'cl-primary', type: 'submit', text: 'Start' })
      ]);
      head.append(el('div', { class: 'cl-head-text' }, [el('b', { text: 'Comment as' }), form]));
      setTimeout(() => input.focus(), 0);
    } else {
      const sub = el('small', { class: name ? 'cl-who-btn' : '', title: name ? 'Change name' : '', text: name ? name + (admin ? ' · admin' : '') + (mode ? ' · click anything to leave a note' : '') : 'Turn on to leave a note' });
      if (name) sub.addEventListener('click', () => { name = ''; if (mode) renderBar(); else setMode(true); bar.classList.add('is-open'); });
      head.append(
        el('div', { class: 'cl-head-text' }, [el('b', { text: 'Commenting' }), sub]),
        el('button', { class: 'cl-switch', type: 'button', role: 'switch', 'aria-checked': String(mode), 'aria-label': mode ? 'Turn commenting off' : 'Turn commenting on', onclick: () => setMode(!mode) }));
    }

    const list = el('div', { class: 'cl-peek-list' });
    if (!here.length) list.append(el('div', { class: 'cl-peek-empty', text: mode ? 'No notes on this page yet. Click anything to leave one.' : 'No notes on this page yet.' }));
    here.forEach((c, i) => list.append(el('a', { class: 'cl-peek' + (c.resolved ? ' cl-peek-resolved' : ''), href: '#cl-' + c.id, onclick: e => { e.preventDefault(); bar.classList.remove('is-open'); focusComment(c.id); } }, [
      el('span', { class: 'cl-peek-n', text: String(i + 1) }),
      el('span', { class: 'cl-peek-body' }, [
        el('span', { class: 'cl-peek-who' }, [el('b', { text: c.author }), ' · ' + when(c.createdAt)]),
        el('span', { class: 'cl-peek-text', text: c.text })
      ])
    ])));

    if (themeOpen) {
      const sources = themeSources();
      const fields = {};
      const draft = () => { const d = {}; THEME_KEYS.forEach(k => { d[k] = fields[k].value.trim(); }); return d; };
      const rows = sources.map(t => {
        const current = t.custom || t.config || t.site || THEME_DEFAULTS[t.key] || contrastOn(resolvedTheme().secondary);
        const origin = t.custom ? 'custom' : t.config ? 'from the embed' : t.site ? 'from this site' : t.key === 'tertiary' && !THEME_DEFAULTS.tertiary ? 'auto' : 'default';
        const swatch = el('input', { type: 'color', value: toHex(current), 'aria-label': THEME_LABELS[t.key] + ' color' });
        const hex = el('input', { type: 'text', value: t.custom ? t.custom : '', placeholder: toHex(current), maxlength: '40', 'aria-label': THEME_LABELS[t.key] + ' hex' });
        fields[t.key] = hex;
        swatch.addEventListener('input', () => { hex.value = swatch.value; });
        hex.addEventListener('input', () => { if (isColor(hex.value)) swatch.value = toHex(hex.value); });
        return el('label', { class: 'cl-theme-row' }, [
          el('span', { class: 'cl-theme-name' }, [THEME_LABELS[t.key], el('small', { text: origin })]),
          swatch, hex
        ]);
      });
      const form = el('form', { class: 'cl-theme', onsubmit: e => { e.preventDefault(); saveTheme(draft()); themeOpen = false; renderBar(); toast('Theme saved for this site.'); } }, [
        ...rows,
        el('div', { class: 'cl-theme-actions' }, [
          el('button', { class: 'cl-primary', type: 'submit', text: 'Save' }),
          el('button', { type: 'button', text: 'Use site colors', onclick: () => { saveTheme({}); themeOpen = false; renderBar(); } }),
          el('span', { class: 'cl-spacer' }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => { themeOpen = false; renderBar(); } })
        ])
      ]);
      mountDock(el('div', { class: 'cl-panel', role: 'group', 'aria-label': 'CommentLayer theme' }, [
        el('div', { class: 'cl-head' }, [el('div', { class: 'cl-head-text' }, [el('b', { text: 'Theme' }), el('small', { text: 'Colors for CommentLayer on ' + location.host })])]),
        form
      ]), themeTab());
      return;
    }

    const foot = el('div', { class: 'cl-foot' }, [
      el('button', { type: 'button', text: 'All comments', onclick: () => { bar.classList.remove('is-open'); openDrawer(); } }),
      el('a', { href: BASE + '/comments.csv', text: 'Export' }),
      el('button', { type: 'button', text: 'Theme', onclick: () => { themeOpen = true; bar.classList.add('is-open'); renderBar(); } }),
      el('span', { class: 'cl-spacer' }),
      viewingOld()
        ? el('button', { class: 'cl-round', type: 'button', text: 'Viewing ' + roundLabel(view) + ' · back', title: 'Return to ' + roundLabel(currentVersion), onclick: () => setView(currentVersion) })
        : el('span', { class: 'cl-round', text: roundLabel(view).toUpperCase() })
    ]);

    mountDock(el('div', { class: 'cl-panel', role: 'group', 'aria-label': 'CommentLayer' }, [head, list, foot]), themeTab());
  }

  function themeTab() {
    const open = comments.filter(c => !c.resolved).length;
    const tab = el('button', { class: 'cl-tab', type: 'button', 'aria-expanded': String(bar.classList.contains('is-open')), onclick: () => { const o = bar.classList.toggle('is-open'); if (!o) themeOpen = false; tab.setAttribute('aria-expanded', String(o)); if (!o) renderBar(); } }, [
      statusDot(),
      (viewingOld() ? roundLabel(view) : 'Comments') + ' ',
      el('span', { class: 'cl-count', text: `(${open})` })
    ]);
    return tab;
  }

  function setMode(on) {
    mode = on;
    ss.set('cl-mode', on ? 'on' : 'off');
    layer.classList.toggle('cl-on', on);
    closePop();
    if (on && !name) bar.classList.add('is-open');
    renderBar();
    if (on) { renderPins(); if (name) toast('Click anywhere on the page to leave a comment.'); }
  }

  function renderPins() {
    layer.replaceChildren();
    const ordered = comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    ordered.forEach((c, i) => {
      const p = resolvePoint(c);
      const pin = el('button', { class: 'cl-pin' + (c.resolved ? ' cl-resolved' : '') + (viewingOld() ? ' cl-old' : ''), type: 'button', text: String(i + 1), title: `${c.author}: ${c.text.slice(0, 80)}`, 'data-id': c.id, onclick: e => { e.stopPropagation(); openPop(c, pin); } });
      pin.style.left = p.left + 'px';
      pin.style.top = p.top + 'px';
      layer.append(pin);
    });
  }

  function closePop() {
    if (activePop) { activePop.remove(); activePop = null; }
    layer.querySelectorAll('.cl-draft').forEach(d => d.remove());
    layer.querySelectorAll('.cl-active').forEach(p => p.classList.remove('cl-active'));
  }
  function placePop(pop, left, top) {
    pop.style.left = Math.max(12 + window.scrollX, Math.min(left + 18, window.scrollX + window.innerWidth - 312)) + 'px';
    pop.style.top = (top - 10) + 'px';
  }

  function openPop(c, pin) {
    closePop();
    pin.classList.add('cl-active');
    const pop = el('div', { class: 'cl-pop cl-ui', onclick: e => e.stopPropagation() });
    const meta = el('div', { class: 'cl-meta' });
    meta.append(el('b', { text: c.author }), el('span', { text: when(c.createdAt) + (c.updatedAt ? ' · edited' : '') }));
    pop.append(meta);
    if (c.version !== currentVersion) pop.append(el('div', { style: 'margin-bottom:8px' }, [el('span', { class: 'cl-round-pill', text: roundLabel(c.version) })]));
    if (c.resolved) pop.append(el('div', { style: 'margin-bottom:8px' }, [el('span', { class: 'cl-resolved-tag', text: 'Resolved' })]));
    const text = el('p', { class: 'cl-text', text: c.text });
    pop.append(text);
    const actions = el('div', { class: 'cl-actions' });
    actions.append(el('button', { type: 'button', text: c.resolved ? 'Reopen' : 'Resolve', onclick: async () => {
      try { const u = await api('PATCH', `${API}/${c.id}`, { resolved: !c.resolved }); Object.assign(c, u); await refresh(); toast(u.resolved ? 'Marked resolved.' : 'Reopened.'); } catch (err) { toast(err.message); }
    } }));
    if (c.mine) {
      actions.append(el('button', { type: 'button', text: 'Edit', onclick: () => {
        const ta = el('textarea', { maxlength: '4000' }); ta.value = c.text;
        text.replaceWith(ta); actions.replaceChildren(
          el('button', { class: 'cl-primary', type: 'button', text: 'Save', onclick: async () => {
            const v = ta.value.trim(); if (!v) return;
            try { const u = await api('PATCH', `${API}/${c.id}`, { text: v }); Object.assign(c, u); await refresh(); openPop(c, layer.querySelector(`[data-id="${c.id}"]`)); toast('Comment updated.'); } catch (err) { toast(err.message); }
          } }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => openPop(c, pin) }));
        ta.focus();
      } }));
      actions.append(el('span', { class: 'cl-spacer' }), el('button', { class: 'cl-danger', type: 'button', text: 'Delete', onclick: async () => {
        if (!confirm('Delete this comment?')) return;
        try { await api('DELETE', `${API}/${c.id}`); await refresh(); closePop(); toast('Comment deleted.'); } catch (err) { toast(err.message); }
      } }));
    }
    actions.append(el('button', { type: 'button', text: 'Close', onclick: closePop }));
    pop.append(actions);
    layer.append(pop);
    activePop = pop;
    placePop(pop, parseFloat(pin.style.left), parseFloat(pin.style.top));
  }

  function openNew(e) {
    closePop();
    if (viewingOld()) { toast('You are viewing ' + roundLabel(view) + '. Switch back to ' + roundLabel(currentVersion) + ' to add comments.'); return; }
    const anchor = anchorFor(e.target);
    const r = anchor.getBoundingClientRect();
    const draft = {
      page, selector: pathFor(anchor),
      x: r.width ? (e.clientX - r.left) / r.width : 0, y: r.height ? (e.clientY - r.top) / r.height : 0,
      px: e.pageX, py: e.pageY, author: name
    };
    const pin = el('button', { class: 'cl-pin cl-draft', type: 'button', text: '+' });
    pin.style.left = e.pageX + 'px'; pin.style.top = e.pageY + 'px';
    layer.append(pin);
    const pop = el('div', { class: 'cl-pop cl-ui', onclick: ev => ev.stopPropagation() });
    const meta = el('div', { class: 'cl-meta' }); meta.append(el('b', { text: name }), el('span', { text: 'New comment' }));
    const ta = el('textarea', { placeholder: 'What should change here?', maxlength: '4000' });
    const actions = el('div', { class: 'cl-actions' }, [
      el('button', { class: 'cl-primary', type: 'button', text: 'Post', onclick: async () => {
        const v = ta.value.trim(); if (!v) { ta.focus(); return; }
        try { await api('POST', API, { ...draft, text: v }); await refresh(); closePop(); toast('Comment posted.'); } catch (err) { toast(err.message); }
      } }),
      el('button', { type: 'button', text: 'Cancel', onclick: closePop })
    ]);
    pop.append(meta, ta, actions);
    layer.append(pop);
    activePop = pop;
    placePop(pop, e.pageX, e.pageY);
    ta.addEventListener('keydown', ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') actions.firstChild.click(); });
    ta.focus();
  }

  let drawer = null;
  function closeDrawer() { if (drawer) { drawer.remove(); drawer = null; } }
  async function openDrawer() {
    closeDrawer();
    await refresh();
    const shown = all.filter(c => c.version === view);
    drawer = el('aside', { class: 'cl-drawer cl-ui', role: 'dialog', 'aria-label': 'All comments' });

    const head = el('div', { class: 'cl-drawer-head' }, [
      el('div', { class: 'cl-drawer-title' }, [
        el('span', { class: 'cl-kicker', text: 'All comments' }),
        el('h2', {}, [roundLabel(view) + ' ', el('span', { class: 'cl-count', text: `(${shown.length})` })])
      ]),
      el('button', { class: 'cl-close', type: 'button', 'aria-label': 'Close', title: 'Close', text: '×', onclick: closeDrawer })
    ]);

    const rounds = el('div', { class: 'cl-rounds', role: 'tablist', 'aria-label': 'Review rounds' });
    versions.forEach(v => rounds.append(el('button', { type: 'button', role: 'tab', class: v.id === view ? 'cl-round-active' : '', 'aria-selected': String(v.id === view), title: v.id === currentVersion ? 'Current round' : 'Started ' + when(v.createdAt), onclick: () => { setView(v.id); openDrawer(); } }, [v.label + ' ', el('span', { class: 'cl-count', text: String(v.count) })])));
    if (admin) rounds.append(el('button', { type: 'button', class: 'cl-round-new', text: '+ New round', onclick: async () => {
      const label = prompt('Name for the new review round', `Round ${versions.length + 1}`);
      if (label === null) return;
      try { const r = await api('POST', VERSIONS, { label: label.trim() || undefined }); await refresh(); setView(r.id); await openDrawer(); toast(r.label + ' started. Older comments are stored under their own rounds.'); } catch (err) { toast(err.message); }
    } }));

    const body = el('div', { class: 'cl-drawer-body' });
    if (viewingOld()) body.append(el('p', { class: 'cl-round-note', text: 'An earlier round. Its pins show on the page while you view it; new comments go to ' + roundLabel(currentVersion) + '.' }));
    if (!shown.length) body.append(el('p', { class: 'cl-empty', text: viewingOld() ? 'No comments in this round.' : 'No comments in this round yet. Turn commenting on and click anything on a page.' }));
    const groups = {};
    shown.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(c => (groups[c.page] = groups[c.page] || []).push(c));
    Object.keys(groups).sort((a, b) => (a === page ? -1 : b === page ? 1 : a.localeCompare(b))).forEach(p => {
      const open = groups[p].filter(c => !c.resolved).length;
      body.append(el('div', { class: 'cl-group' }, [
        el('span', { class: 'cl-group-name', text: pageLabel(p) + (p === page ? ' · this page' : '') }),
        el('span', { class: 'cl-group-count', text: open ? `${open} open` : 'all resolved' })
      ]));
      groups[p].forEach((c, i) => {
        const item = el('a', { class: 'cl-item' + (c.resolved ? ' cl-item-resolved' : ''), href: `${p}#cl-${c.id}`, onclick: e => {
          if (p !== page) return;
          e.preventDefault(); closeDrawer(); focusComment(c.id);
        } }, [
          el('span', { class: 'cl-peek-n', text: String(i + 1) }),
          el('span', { class: 'cl-item-body' }, [
            el('span', { class: 'cl-peek-who' }, [el('b', { text: c.author }), ' · ' + when(c.createdAt) + (c.resolved ? ' · resolved' : '')]),
            el('span', { class: 'cl-item-text', text: c.text })
          ])
        ]);
        if (c.mine) item.append(el('button', { class: 'cl-item-delete', type: 'button', text: 'Delete', 'aria-label': 'Delete this comment', onclick: async e => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm('Delete this comment?')) return;
          try { await api('DELETE', `${API}/${c.id}`); closePop(); await openDrawer(); toast('Comment deleted.'); } catch (err) { toast(err.message); }
        } }));
        body.append(item);
      });
    });

    const foot = el('div', { class: 'cl-drawer-foot' }, [
      el('a', { href: `${API}.csv`, text: 'Export CSV' }),
      el('a', { href: API, target: '_blank', rel: 'noopener', text: 'Export JSON' })
    ]);
    if (admin && viewingOld()) foot.append(el('button', { type: 'button', text: 'Rename round', onclick: async () => {
      const label = prompt('Rename this round', roundLabel(view));
      if (!label || !label.trim()) return;
      try { await api('PATCH', `${VERSIONS}/${view}`, { label: label.trim() }); await refresh(); await openDrawer(); } catch (err) { toast(err.message); }
    } }));
    foot.append(el('span', { class: 'cl-spacer' }), el('span', { class: 'cl-round', text: `${shown.filter(c => !c.resolved).length} OPEN · ${shown.filter(c => c.resolved).length} RESOLVED` }));

    drawer.append(head, rounds, body, foot);
    document.body.append(drawer);
    requestAnimationFrame(() => drawer && drawer.classList.add('is-in'));
  }

  function focusComment(id) {
    if (!mode) setMode(true);
    const target = all.find(item => item.id === id);
    if (target && target.version !== view) setView(target.version);
    const c = comments.find(item => item.id === id);
    const pin = layer.querySelector(`[data-id="${id}"]`);
    if (!c || !pin) { toast('That comment is on another page or was deleted.'); return; }
    window.scrollTo({ top: Math.max(0, parseFloat(pin.style.top) - window.innerHeight / 2), behavior: 'smooth' });
    setTimeout(() => openPop(c, pin), 350);
  }

  async function refresh() {
    try {
      const [list, info] = await Promise.all([api('GET', API), api('GET', VERSIONS)]);
      all = list;
      versions = info.versions;
      currentVersion = info.current;
      if (!versions.some(v => v.id === view)) view = currentVersion;
      comments = all.filter(c => c.page === page && c.version === view);
      renderBar();
      renderPins();
    } catch {
      renderBar();
      toast('Comments unavailable right now.');
    }
  }

  document.addEventListener('click', e => {
    if (!mode) return;
    if (e.target.closest('.cl-ui')) return;
    e.preventDefault();
    e.stopPropagation();
    if (activePop) { closePop(); return; }
    if (!name) { renderBar(); return; }
    openNew(e);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeDrawer(); bar.classList.remove('is-open'); if (themeOpen) { themeOpen = false; renderBar(); } } });
  let raf = 0;
  const relayout = () => { if (!mode) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { renderPins(); if (activePop) closePop(); }); };
  window.addEventListener('resize', relayout);
  window.addEventListener('load', () => { if (mode) renderPins(); });
  new ResizeObserver(relayout).observe(document.body);

  const onNavigate = () => {
    const next = pageKey();
    if (next === page) return;
    page = next;
    closePop();
    closeDrawer();
    refresh();
  };
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(onNavigate); return r; };
  });
  window.addEventListener('popstate', onNavigate);

  applyTheme();
  renderBar();
  layer.classList.toggle('cl-on', mode);
  refresh().then(() => {
    if (adminMatch) toast('Admin mode on: you can edit or delete any comment.');
    const m = location.hash.match(/^#cl-(.+)$/);
    if (m) { setMode(true); setTimeout(() => focusComment(m[1]), 250); }
  });
}

  // Hosts can set window.CommentLayerConfig to an object or a promise of one ({ api, fetch, storage });
  // a promise that resolves to null means "not on this page". The browser extension uses this.
  const cfg = window.CommentLayerConfig;
  if (cfg && typeof cfg.then === 'function') cfg.then(c => c && init(c));
  else init(cfg || {});
})();
