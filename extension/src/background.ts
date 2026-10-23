// CommentLayer extension service worker. Holds the layers a reviewer belongs to, talks to
// Google Sheets or a backend on behalf of the content script, and runs the comment store
// in-process for sheet layers so no server is involved.
import { createCommentStore, createHandler, type CommentStore } from "../../src/core";
import { createLayerSpreadsheet, parseSpreadsheetId, sheetsPersistence, SheetsError } from "../../src/sheets";

export type Layer =
  | { id: string; type: "sheet"; name: string; spreadsheetId: string; url: string; sites: Record<string, true> }
  | { id: string; type: "backend"; name: string; api: string; sites: Record<string, true> };

type Settings = { layers: Layer[]; activeLayer: string; values: Record<string, string | null> };

const VALUE_KEYS = ["cl-token", "cl-name", "cl-admin", "cl-theme"];
const LOCAL_BASE = "https://layer.commentlayer.local/api/commentlayer";

async function settings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["layers", "activeLayer", "api", "sites", ...VALUE_KEYS]);
  let layers: Layer[] = Array.isArray(s.layers) ? s.layers : [];
  // Migrate the single-backend shape from earlier builds.
  if (!layers.length && s.api) {
    layers = [{ id: "l-" + crypto.randomUUID().slice(0, 8), type: "backend", name: "Backend", api: String(s.api).replace(/\/$/, ""), sites: s.sites || {} }];
    await chrome.storage.local.set({ layers, activeLayer: layers[0].id });
    await chrome.storage.local.remove(["api", "sites"]);
  }
  if (!s["cl-token"]) {
    s["cl-token"] = crypto.randomUUID();
    await chrome.storage.local.set({ "cl-token": s["cl-token"] });
  }
  const activeLayer = layers.some((l) => l.id === s.activeLayer) ? s.activeLayer : layers[0]?.id ?? "";
  return { layers, activeLayer, values: Object.fromEntries(VALUE_KEYS.map((k) => [k, s[k] || null])) };
}

const layerForHost = (s: Settings, host: string) => s.layers.find((l) => l.sites[host]) ?? null;

// ── Google ───────────────────────────────────────────────────────────────────
async function googleToken(interactive: boolean): Promise<string> {
  const r = await chrome.identity.getAuthToken({ interactive });
  const token = typeof r === "string" ? r : r?.token;
  if (!token) throw new Error("Google sign-in was cancelled.");
  return token;
}

async function forgetToken() {
  try {
    const r = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof r === "string" ? r : r?.token;
    if (token) await chrome.identity.removeCachedAuthToken({ token });
  } catch {}
}

async function googleName(): Promise<string> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${await googleToken(false)}` } });
    const info = (await res.json()) as { given_name?: string; name?: string };
    return info.given_name || info.name || "";
  } catch {
    return "";
  }
}

// ── stores for sheet layers ──────────────────────────────────────────────────
const STORE_TTL = 12_000;
const stores = new Map<string, { store: CommentStore; loadedAt: number }>();

async function sheetStore(layer: Extract<Layer, { type: "sheet" }>, fresh = false): Promise<CommentStore> {
  const cached = stores.get(layer.id);
  if (cached && !fresh && Date.now() - cached.loadedAt < STORE_TTL) return cached.store;
  const persistence = sheetsPersistence({ spreadsheetId: layer.spreadsheetId, token: () => googleToken(false) });
  const s = await settings();
  const store = await createCommentStore({ persistence, adminToken: s.values["cl-admin"] || undefined });
  stores.set(layer.id, { store, loadedAt: Date.now() });
  return store;
}

async function handleLocally(layer: Extract<Layer, { type: "sheet" }>, url: string, init: RequestInit) {
  const method = (init.method || "GET").toUpperCase();
  const handle = createHandler(() => sheetStore(layer, method !== "GET"), { base: "/api/commentlayer" });
  const res = await handle(new Request(url, init));
  if (method !== "GET") stores.delete(layer.id);
  const type = res.headers.get("content-type") || "";
  if (res.status === 204) return { status: 204, body: null, text: "" };
  if (type.includes("text/csv")) return { status: res.status, body: null, text: await res.text() };
  return { status: res.status, body: await res.json().catch(() => ({})), text: "" };
}

// ── messages from the content script and the options page ───────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === "config") {
        const s = await settings();
        const layer = layerForHost(s, msg.host);
        const hostKey = "cl-theme:" + msg.host;
        const perHost = await chrome.storage.local.get(hostKey);
        s.values[hostKey] = perHost[hostKey] || s.values["cl-theme"] || null;
        if (layer && !s.values["cl-name"] && layer.type === "sheet") {
          const name = await googleName();
          if (name) {
            s.values["cl-name"] = name;
            await chrome.storage.local.set({ "cl-name": name });
          }
        }
        reply({ enabled: !!layer, api: layer ? (layer.type === "backend" ? layer.api : LOCAL_BASE) : "", layer: layer ? { id: layer.id, name: layer.name, type: layer.type } : null, values: s.values });
      } else if (msg.type === "set") {
        await chrome.storage.local.set({ [msg.key]: msg.value });
        if (msg.key === "cl-admin") stores.clear();
        reply(true);
      } else if (msg.type === "fetch") {
        const s = await settings();
        const layer = layerForHost(s, msg.host);
        if (!layer) {
          reply({ status: 404, body: { error: "No layer for this site." }, text: "" });
        } else if (layer.type === "sheet") {
          reply(await handleLocally(layer, msg.url, msg.init));
        } else {
          const res = await fetch(msg.url, msg.init);
          const type = res.headers.get("content-type") || "";
          reply({ status: res.status, body: res.status === 204 || type.includes("text/csv") ? null : await res.json().catch(() => ({})), text: type.includes("text/csv") ? await res.text() : "" });
        }
      } else if (msg.type === "layers") {
        const s = await settings();
        reply({ layers: s.layers, activeLayer: s.activeLayer, name: s.values["cl-name"] });
      } else if (msg.type === "saveLayers") {
        await chrome.storage.local.set({ layers: msg.layers, activeLayer: msg.activeLayer });
        stores.clear();
        reply(true);
      } else if (msg.type === "signIn") {
        await googleToken(true);
        const name = await googleName();
        if (name && !(await settings()).values["cl-name"]) await chrome.storage.local.set({ "cl-name": name });
        reply({ ok: true, name });
      } else if (msg.type === "signOut") {
        await forgetToken();
        reply({ ok: true });
      } else if (msg.type === "createSheet") {
        await googleToken(true);
        const created = await createLayerSpreadsheet(`CommentLayer · ${msg.name}`, () => googleToken(false));
        const s = await settings();
        const layer: Layer = { id: "l-" + crypto.randomUUID().slice(0, 8), type: "sheet", name: msg.name, spreadsheetId: created.spreadsheetId, url: created.url, sites: {} };
        await chrome.storage.local.set({ layers: [...s.layers, layer], activeLayer: layer.id });
        reply({ ok: true, layer });
      } else if (msg.type === "openSheet") {
        const spreadsheetId = parseSpreadsheetId(msg.link);
        if (!spreadsheetId) throw new Error("That doesn't look like a Google Sheets link.");
        await googleToken(true);
        const probe: Extract<Layer, { type: "sheet" }> = { id: "probe", type: "sheet", name: "", spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`, sites: {} };
        await sheetStore(probe, true);
        stores.delete("probe");
        const s = await settings();
        const layer: Layer = { ...probe, id: "l-" + crypto.randomUUID().slice(0, 8), name: msg.name || "Shared layer" };
        await chrome.storage.local.set({ layers: [...s.layers, layer], activeLayer: layer.id });
        reply({ ok: true, layer });
      }
    } catch (err) {
      if (err instanceof SheetsError && err.status === 401) await forgetToken();
      reply({ error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});

// ── toolbar icon: toggle the current site on the active layer ────────────────
const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
};

async function badge(tabId: number, host: string) {
  const s = await settings();
  const layer = layerForHost(s, host);
  chrome.action.setBadgeText({ tabId, text: layer ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#c94a8f" });
  chrome.action.setTitle({ tabId, title: layer ? `CommentLayer: on (${layer.name}). Click to turn off.` : "CommentLayer: click to turn on for this site" });
}

chrome.action.onClicked.addListener(async (tab) => {
  const host = hostOf(tab.url);
  if (!host || tab.id === undefined) return;
  const s = await settings();
  if (!s.layers.length) {
    chrome.runtime.openOptionsPage();
    return;
  }
  const current = layerForHost(s, host);
  const layers = s.layers.map((l) => ({ ...l, sites: { ...l.sites } }));
  if (current) {
    for (const l of layers) delete l.sites[host];
  } else {
    const target = layers.find((l) => l.id === s.activeLayer) ?? layers[0];
    target.sites[host] = true;
  }
  await chrome.storage.local.set({ layers });
  await badge(tab.id, host);
  chrome.tabs.reload(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url) badge(tabId, hostOf(tab.url));
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) badge(tabId, hostOf(tab.url));
});
