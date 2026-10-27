const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
let state = { layers: [], activeLayer: '' };

const toast = text => { const t = $('toast'); t.textContent = text; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2200); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const JOIN_URL = 'https://summitml.com/commentlayer/join';
const inviteFor = l => l.type === 'hosted'
  ? `${JOIN_URL}#layer=${encodeURIComponent(l.layerId)}&key=${encodeURIComponent(l.key)}&name=${encodeURIComponent(l.name)}`
  : `${JOIN_URL}#sheet=${encodeURIComponent(l.spreadsheetId)}&name=${encodeURIComponent(l.name)}`;

function render() {
  const root = $('layers');
  if (!state.layers.length) { root.innerHTML = '<p class="empty">No layers yet. Create one below.</p>'; return; }
  root.innerHTML = state.layers.map(l => {
    const sites = Object.keys(l.sites);
    const where = l.type === 'hosted' ? `Hosted · kept ${l.ttlDays || 30} days after the last note${l.adminKey ? ' · you are the admin' : ''}` : l.type === 'sheet' ? `Google Sheet · <a href="${esc(l.url)}" target="_blank" rel="noopener">open</a>` : `Backend · ${esc(l.api)}`;
    return `<div class="card layer" data-id="${esc(l.id)}">
      <div><b>${esc(l.name)}</b><div class="meta">${where}</div></div>
      <div class="actions">
        <button data-act="active" class="${l.id === state.activeLayer ? 'active' : ''}">${l.id === state.activeLayer ? 'Active' : 'Make active'}</button>
        ${l.type === 'hosted' || l.type === 'sheet' ? '<button data-act="invite">Copy invite</button>' : ''}
        ${l.type === 'hosted' && l.adminKey ? '<button data-act="delete">Delete layer</button>' : '<button data-act="remove">Remove</button>'}
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
  else if (act === 'delete') {
    if (!confirm(`Delete "${layer.name}" for everyone? Its comments are gone for good. Export first if you want to keep them.`)) return;
    const r = await send({ type: 'deleteHosted', id: layer.id });
    if (r.error) { toast(r.error); return; }
    toast('Layer deleted.');
    await load();
  }
  else if (act === 'invite') {
    await navigator.clipboard.writeText(`You're invited to comment on a site with CommentLayer. Open this link and it walks you through it:\n${inviteFor(layer)}`);
    toast(layer.type === 'hosted' ? 'Invite link copied. Anyone with it can comment.' : 'Invite link copied. Share the sheet with them as Editor in Drive first, or they will have to request access.');
  }
});

$('create-layer').addEventListener('click', async () => {
  const name = $('new-name').value.trim() || 'My layer';
  $('create-layer').disabled = true;
  const r = await send({ type: 'createHosted', name });
  $('create-layer').disabled = false;
  if (r.error) { toast(r.error); return; }
  $('new-name').value = '';
  toast('Layer created. Click "Copy invite" to bring people in.');
  await load();
});

$('join-link').addEventListener('click', async () => {
  const raw = $('invite-link').value.trim();
  if (!raw) return;
  let hash = '';
  try { hash = new URL(raw).hash; } catch { hash = raw.startsWith('#') ? raw : ''; }
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const name = p.get('name') || '';
  const msg = p.get('layer') && p.get('key') ? { type: 'joinHosted', layerId: p.get('layer'), key: p.get('key'), name }
    : p.get('api') ? { type: 'addBackend', api: p.get('api'), name }
    : p.get('sheet') ? { type: 'openSheet', link: p.get('sheet'), name }
    : null;
  if (!msg) { toast("That doesn't look like a CommentLayer invite link."); return; }
  $('join-link').disabled = true;
  const r = await send(msg);
  $('join-link').disabled = false;
  if (r.error) { toast(r.error); return; }
  $('invite-link').value = '';
  toast(`Joined "${r.layer.name}".`);
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

load();
