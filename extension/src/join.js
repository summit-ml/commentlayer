// Runs on the join page. The page posts a join request; we acknowledge at once, add the layer, then answer.
window.postMessage({ source: 'commentlayer', type: 'present' }, '*');
window.addEventListener('message', async e => {
  if (e.source !== window || !e.data || e.data.source !== 'commentlayer-page' || e.data.type !== 'join') return;
  window.postMessage({ source: 'commentlayer', type: 'present' }, '*');
  let r;
  try { r = await chrome.runtime.sendMessage(e.data.api ? { type: 'addBackend', api: e.data.api, name: e.data.name } : { type: 'openSheet', link: e.data.sheetId, name: e.data.name }); } catch (err) { r = { error: err.message }; }
  window.postMessage({ source: 'commentlayer', type: 'joined', ok: !!(r && r.ok), error: (r && r.error) || 'Could not join.', layer: r && r.layer ? { name: r.layer.name } : null }, '*');
});
