// Runs before commentlayer.js in the same isolated world. Hands the overlay its config,
// a fetch that goes through the service worker (no CORS, and sheet layers never touch the
// network from the page), and storage shared across sites.
window.CommentLayerConfig = chrome.runtime.sendMessage({ type: 'config', host: location.host }).then(cfg => {
  if (!cfg || !cfg.enabled || !cfg.api) return null;
  const cache = Object.assign({}, cfg.values);
  return {
    api: cfg.api,
    scopeHost: true,
    layer: cfg.layer,
    storage: {
      get: k => (k in cache ? cache[k] : null),
      set: (k, v) => { cache[k] = v; chrome.runtime.sendMessage({ type: 'set', key: k, value: v }); }
    },
    fetch: async (url, init) => {
      const r = await chrome.runtime.sendMessage({ type: 'fetch', host: location.host, url, init });
      if (!r || r.error) throw new Error((r && r.error) || 'CommentLayer is not available.');
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body, text: async () => r.text };
    }
  };
});
