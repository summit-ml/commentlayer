const $ = id => document.getElementById(id);
chrome.storage.local.get(['api', 'cl-name', 'cl-admin', 'cl-theme']).then(s => {
  let t = {}; try { t = JSON.parse(s['cl-theme'] || '{}') || {}; } catch {}
  ['primary', 'secondary', 'tertiary'].forEach(k => { $(k).value = t[k] || ''; });
  $('api').value = s.api || '';
  $('name').value = s['cl-name'] || '';
  $('admin').value = s['cl-admin'] || '';
});
$('save').addEventListener('click', async () => {
  const theme = {}; ['primary', 'secondary', 'tertiary'].forEach(k => { const v = $(k).value.trim(); if (v) theme[k] = v; });
  await chrome.storage.local.set({ api: $('api').value.trim().replace(/\/$/, ''), 'cl-name': $('name').value.trim(), 'cl-admin': $('admin').value.trim(), 'cl-theme': Object.keys(theme).length ? JSON.stringify(theme) : '' });
  $('ok').hidden = false;
  setTimeout(() => { $('ok').hidden = true; }, 1500);
});
