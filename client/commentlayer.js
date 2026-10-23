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
  const when = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const pageLabel = p => p === '/' ? 'Home' : p.replace(/^\//, '').split('/').map(s => s.replace(/-/g, ' ')).join(' / ').replace(/^\w/, c => c.toUpperCase());
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
  document.body.append(bar, layer);

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

    const foot = el('div', { class: 'cl-foot' }, [
      el('button', { type: 'button', text: 'All comments', onclick: () => { bar.classList.remove('is-open'); openDrawer(); } }),
      el('a', { href: BASE + '/comments.csv', text: 'Export' }),
      el('span', { class: 'cl-spacer' }),
      viewingOld()
        ? el('button', { class: 'cl-round', type: 'button', text: 'Viewing ' + roundLabel(view) + ' · back', title: 'Return to ' + roundLabel(currentVersion), onclick: () => setView(currentVersion) })
        : el('span', { class: 'cl-round', text: roundLabel(view).toUpperCase() })
    ]);

    const tab = el('button', { class: 'cl-tab', type: 'button', 'aria-expanded': String(bar.classList.contains('is-open')), onclick: () => { const o = bar.classList.toggle('is-open'); tab.setAttribute('aria-expanded', String(o)); } }, [
      el('span', { class: 'cl-dot' }),
      (viewingOld() ? roundLabel(view) : 'Comments') + ' ',
      el('span', { class: 'cl-count', text: `(${open})` })
    ]);
    bar.append(el('div', { class: 'cl-panel', role: 'group', 'aria-label': 'CommentLayer' }, [head, list, foot]), tab);
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
    const head = el('div', { class: 'cl-drawer-head' }, [el('h2', { text: `${roundLabel(view)} (${shown.length})` }), el('button', { class: 'cl-close', type: 'button', text: 'Close', onclick: closeDrawer })]);
    const rounds = el('div', { class: 'cl-rounds', role: 'tablist', 'aria-label': 'Review rounds' });
    versions.forEach(v => rounds.append(el('button', { type: 'button', role: 'tab', class: v.id === view ? 'cl-round-active' : '', 'aria-selected': String(v.id === view), text: `${v.label} (${v.count})`, title: v.id === currentVersion ? 'Current round' : 'Started ' + when(v.createdAt), onclick: () => { setView(v.id); openDrawer(); } })));
    if (admin) rounds.append(el('button', { type: 'button', class: 'cl-round-new', text: '+ New round', onclick: async () => {
      const label = prompt('Name for the new review round', `Round ${versions.length + 1}`);
      if (label === null) return;
      try { const r = await api('POST', VERSIONS, { label: label.trim() || undefined }); await refresh(); setView(r.id); await openDrawer(); toast(r.label + ' started. Older comments are stored under their own rounds.'); } catch (err) { toast(err.message); }
    } }));
    const tools = el('div', { class: 'cl-tools' }, [
      el('a', { href: `${API}.csv`, text: 'Export CSV' }),
      el('a', { href: API, target: '_blank', rel: 'noopener', text: 'Export JSON' })
    ]);
    if (admin && viewingOld()) tools.append(el('button', { type: 'button', text: 'Rename round', onclick: async () => {
      const label = prompt('Rename this round', roundLabel(view));
      if (!label || !label.trim()) return;
      try { await api('PATCH', `${VERSIONS}/${view}`, { label: label.trim() }); await refresh(); await openDrawer(); } catch (err) { toast(err.message); }
    } }));
    drawer.append(head, rounds);
    if (viewingOld()) drawer.append(el('p', { class: 'cl-round-note', text: 'An earlier round. Its pins show on the page while you view it; new comments go to ' + roundLabel(currentVersion) + '.' }));
    drawer.append(tools);
    if (!shown.length) drawer.append(el('p', { class: 'cl-empty', text: viewingOld() ? 'No comments in this round.' : 'No comments in this round yet. Turn on comment mode and click anywhere on a page.' }));
    const groups = {};
    shown.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(c => (groups[c.page] = groups[c.page] || []).push(c));
    Object.keys(groups).sort((a, b) => (a === page ? -1 : b === page ? 1 : a.localeCompare(b))).forEach(p => {
      drawer.append(el('h3', { text: `${pageLabel(p)} (${groups[p].length})` }));
      groups[p].forEach(c => {
        const meta = el('div', { class: 'cl-meta' }); meta.append(el('b', { text: c.author }), el('span', { text: when(c.createdAt) + (c.resolved ? ' · resolved' : '') }));
        const item = el('a', { class: 'cl-item' + (c.resolved ? ' cl-item-resolved' : ''), href: `${p}#cl-${c.id}`, onclick: e => {
          if (p !== page) return;
          e.preventDefault(); closeDrawer(); focusComment(c.id);
        } }, [meta, el('p', { text: c.text })]);
        if (c.mine) item.append(el('button', { class: 'cl-item-delete', type: 'button', text: 'Delete', onclick: async e => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm('Delete this comment?')) return;
          try { await api('DELETE', `${API}/${c.id}`); closePop(); await openDrawer(); toast('Comment deleted.'); } catch (err) { toast(err.message); }
        } }));
        drawer.append(item);
      });
    });
    document.body.append(drawer);
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
      bar.replaceChildren(el('span', { class: 'cl-label', text: 'Comments unavailable right now.' }));
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeDrawer(); bar.classList.remove('is-open'); } });
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
