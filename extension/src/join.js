// Runs on the join page. The page says hello and we answer that the extension is here; when the visitor
// clicks Join it posts a join request, and we add the layer and answer with the result.
window.postMessage({ source: 'commentlayer', type: 'present' }, '*');
window.addEventListener('message', async e => {
  if (e.source !== window || !e.data || e.data.source !== 'commentlayer-page') return;
  if (e.data.type === 'hello') { window.postMessage({ source: 'commentlayer', type: 'present' }, '*'); return; }
  if (e.data.type !== 'join') return;
  let r;
  const d = e.data;
  const msg = d.layerId ? { type: 'joinHosted', layerId: d.layerId, key: d.key, name: d.name } : d.api ? { type: 'addBackend', api: d.api, name: d.name } : { type: 'openSheet', link: d.sheetId, name: d.name };
  try { r = await chrome.runtime.sendMessage(msg); } catch (err) { r = { error: err.message }; }
  window.postMessage({ source: 'commentlayer', type: 'joined', ok: !!(r && r.ok), error: (r && r.error) || 'Could not join.', needsAccess: !!(r && r.needsAccess), layer: r && r.layer ? { name: r.layer.name } : null }, '*');
});
