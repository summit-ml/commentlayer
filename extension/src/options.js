const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
let state = { layers: [], activeLayer: '' };

const toast = text => { const t = $('toast'); t.textContent = text; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function render() {
  const root = $('layers');
  if (!state.layers.length) { root.innerHTML = '<p class="empty">No layers yet. Create a Google Sheet layer below.</p>'; return; }
  root.innerHTML = state.layers.map(l => {
    const sites = Object.keys(l.sites);
    const where = l.type === 'sheet' ? `Google Sheet · <a href="${esc(l.url)}" target="_blank" rel="noopener">open</a>` : `Backend · ${esc(l.api)}`;
    return `<div class="card layer" data-id="${esc(l.id)}">
      <div><b>${esc(l.name)}</b><div class="meta">${where}</div></div>
      <div class="actions">
        <button data-act="active" class="${l.id === state.activeLayer ? 'active' : ''}">${l.id === state.activeLayer ? 'Active' : 'Make active'}</button>
        ${l.type === 'sheet' ? '<button data-act="invite">Copy invite</button>' : ''}
        <button data-act="remove">Remove</button>
      </div>
      <div class="sites">${sites.length ? sites.map(h => `<span class="chip">${esc(h)}<button data-act="unsite" data-host="${esc(h)}" title="Turn off on this site">×</button></span>`).join('') : '<span class="hint">On no sites yet. Click the toolbar icon on a site.</span>'}</div>
    </div>`;
  }).join('');
}

async function load() {
  const r = await send({ type: 'layers' });
  state = { layers: r.layers || [], activeLayer: r.activeLayer || '' };
  render();
  const s = await chrome.storage.local.get(['cl-name', 'cl-admin', 'cl-theme']);
  $('name').value = r.name || s['cl-name'] || '';
  $('admin').value = s['cl-admin'] || '';
  let t = {}; try { t = JSON.parse(s['cl-theme'] || '{}') || {}; } catch {}
  ['primary', 'secondary', 'tertiary'].forEach(k => { $(k).value = t[k] || ''; });
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
}

async function saveLayers() {
  await send({ type: 'saveLayers', layers: state.layers, activeLayer: state.activeLayer });
  render();
}

$('layers').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.layer');
  const layer = state.layers.find(l => l.id === card.dataset.id);
  if (!layer) return;
  const act = btn.dataset.act;
  if (act === 'active') { state.activeLayer = layer.id; await saveLayers(); }
  else if (act === 'remove') { if (!confirm(`Remove "${layer.name}" from this browser? The comments stay where they are.`)) return; state.layers = state.layers.filter(l => l.id !== layer.id); if (state.activeLayer === layer.id) state.activeLayer = state.layers[0]?.id || ''; await saveLayers(); }
  else if (act === 'unsite') { delete layer.sites[btn.dataset.host]; await saveLayers(); }
  else if (act === 'invite') {
    const text = `Join my CommentLayer: ${layer.url}\n\n1. Install the CommentLayer extension.\n2. Open its options, paste this link under "open a sheet someone shared with you".\n3. Click the toolbar icon on the site we're reviewing.\n\n(I've shared the sheet with you in Google Drive.)`;
    await navigator.clipboard.writeText(text);
    toast('Invite copied. Share the sheet in Drive too.');
  }
});

$('create-sheet').addEventListener('click', async () => {
  const name = $('new-name').value.trim() || 'My layer';
  $('create-sheet').disabled = true;
  const r = await send({ type: 'createSheet', name });
  $('create-sheet').disabled = false;
  if (r.error) { toast(r.error); return; }
  $('new-name').value = '';
  toast('Layer created. Share the sheet in Drive to invite people.');
  await load();
});

$('open-sheet').addEventListener('click', async () => {
  const link = $('open-link').value.trim();
  if (!link) return;
  $('open-sheet').disabled = true;
  const r = await send({ type: 'openSheet', link, name: $('new-name').value.trim() });
  $('open-sheet').disabled = false;
  if (r.error) { toast(r.error); return; }
  $('open-link').value = '';
  toast('Layer added.');
  await load();
});

$('add-backend').addEventListener('click', async () => {
  const api = $('backend-url').value.trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(api)) { toast('Enter the full API base URL.'); return; }
  state.layers.push({ id: 'l-' + crypto.randomUUID().slice(0, 8), type: 'backend', name: $('backend-name').value.trim() || 'Backend', api, sites: {} });
  if (!state.activeLayer) state.activeLayer = state.layers[state.layers.length - 1].id;
  $('backend-url').value = ''; $('backend-name').value = '';
  await saveLayers();
  toast('Backend layer added.');
});

$('save').addEventListener('click', async () => {
  const theme = {}; ['primary', 'secondary', 'tertiary'].forEach(k => { const v = $(k).value.trim(); if (v) theme[k] = v; });
  await chrome.storage.local.set({ 'cl-name': $('name').value.trim(), 'cl-theme': Object.keys(theme).length ? JSON.stringify(theme) : '' });
  await send({ type: 'set', key: 'cl-admin', value: $('admin').value.trim() });
  toast('Saved');
});

$('sign-out').addEventListener('click', async () => { await send({ type: 'signOut' }); toast('Signed out. You will be asked to sign in again next time.'); });

load();
