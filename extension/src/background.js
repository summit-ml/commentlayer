const KEYS = ['cl-token', 'cl-name', 'cl-admin'];

const settings = async () => {
  const s = await chrome.storage.local.get(['api', 'sites', ...KEYS]);
  if (!s['cl-token']) { s['cl-token'] = crypto.randomUUID(); await chrome.storage.local.set({ 'cl-token': s['cl-token'] }); }
  return { api: (s.api || '').replace(/\/$/, ''), sites: s.sites || {}, values: Object.fromEntries(KEYS.map(k => [k, s[k] || null])) };
};

const badge = async (tabId, host) => {
  const { sites, api } = await settings();
  const on = !!api && !!sites[host];
  chrome.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c94a8f' });
};

const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'config') {
      const s = await settings();
      reply({ enabled: !!s.sites[msg.host], api: s.api, values: s.values });
    } else if (msg.type === 'set') {
      await chrome.storage.local.set({ [msg.key]: msg.value });
      reply(true);
    } else if (msg.type === 'fetch') {
      const res = await fetch(msg.url, msg.init);
      const body = res.status === 204 ? null : await res.json().catch(() => ({}));
      reply({ status: res.status, body });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(async tab => {
  const host = hostOf(tab.url);
  if (!host) return;
  const s = await settings();
  if (!s.api) { chrome.runtime.openOptionsPage(); return; }
  const sites = { ...s.sites };
  if (sites[host]) delete sites[host]; else sites[host] = true;
  await chrome.storage.local.set({ sites });
  await badge(tab.id, host);
  chrome.tabs.reload(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' && tab.url) badge(tabId, hostOf(tab.url)); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { const tab = await chrome.tabs.get(tabId); if (tab.url) badge(tabId, hostOf(tab.url)); });
