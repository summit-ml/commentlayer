const $ = id => document.getElementById(id);
chrome.storage.local.get(['api', 'cl-name', 'cl-admin']).then(s => {
  $('api').value = s.api || '';
  $('name').value = s['cl-name'] || '';
  $('admin').value = s['cl-admin'] || '';
});
$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ api: $('api').value.trim().replace(/\/$/, ''), 'cl-name': $('name').value.trim(), 'cl-admin': $('admin').value.trim() });
  $('ok').hidden = false;
  setTimeout(() => { $('ok').hidden = true; }, 1500);
});
