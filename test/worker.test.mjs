import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { Layer } from "../worker/src/index.ts";

const fakeKV = () => {
  const map = new Map();
  const kv = {
    puts: [],
    get: async (k, type) => (map.has(k) ? (type === "json" ? JSON.parse(map.get(k)) : map.get(k)) : null),
    put: async (k, v, opts) => { map.set(k, v); kv.puts.push({ k, opts }); },
    delete: async (k) => { map.delete(k); },
  };
  return kv;
};

// Stands in for the Durable Object runtime: one Layer per name, each with its own storage and alarm.
const fakeObjects = (env) => {
  const objects = new Map();
  return {
    objects,
    idFromName: (name) => name,
    get: (name) => {
      if (!objects.has(name)) {
        const map = new Map();
        const storage = {
          map,
          alarm: null,
          get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
          put: async (k, v) => { map.set(k, structuredClone(v)); },
          deleteAll: async () => { map.clear(); },
          setAlarm: async (t) => { storage.alarm = t; },
          deleteAlarm: async () => { storage.alarm = null; },
        };
        objects.set(name, { storage, layer: new Layer({ storage }, env) });
      }
      return { fetch: (req) => objects.get(name).layer.fetch(req) };
    },
  };
};

const boot = () => {
  const kv = fakeKV();
  const env = { COMMENTS: kv, STORE_URL: "https://store.test/commentlayer" };
  env.LAYERS = fakeObjects(env);
  const call = (method, path, { body, key, token, admin } = {}) =>
    worker.fetch(new Request(`https://cl.test${path}`, { method, headers: { "Content-Type": "application/json", ...(key ? { "X-Layer-Key": key } : {}), ...(token ? { "X-Comment-Token": token } : {}), ...(admin ? { "X-Comment-Admin": admin } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { kv, call, objects: env.LAYERS.objects };
};

test("mints a layer with an invite key and an admin key, and a sliding 30-day TTL", async () => {
  const { call, objects } = boot();
  const before = Date.now();
  const res = await call("POST", "/api/layers", { body: { name: "Website redesign" } });
  assert.equal(res.status, 201);
  const layer = await res.json();
  assert.equal(layer.name, "Website redesign");
  assert.match(layer.id, /^[A-Za-z0-9_-]{12}$/);
  assert.ok(layer.key.length >= 20 && layer.adminKey.length >= 20 && layer.key !== layer.adminKey);
  assert.equal(layer.ttlDays, 30);
  const { storage } = objects.get(layer.id);
  assert.ok(Math.abs(storage.alarm - (before + 30 * 86_400_000)) < 5000);
  assert.equal(storage.map.get("rec").versions.length, 1);
});

test("the invite key gates reads and writes; the admin key gates rounds and deletion", async () => {
  const { call } = boot();
  const layer = await (await call("POST", "/api/layers", { body: { name: "Staging" } })).json();
  const base = `/api/l/${layer.id}`;

  assert.equal((await call("GET", `${base}/comments`)).status, 403);
  assert.equal((await call("GET", `${base}/comments`, { key: "wrong" })).status, 403);
  assert.equal((await call("GET", `/api/layers/${layer.id}`, { key: layer.key })).status, 200);

  const created = await call("POST", `${base}/comments`, { key: layer.key, token: "ann", body: { page: "/", selector: "h1", x: 0.5, y: 0.2, author: "Ann", text: "Tighter headline" } });
  assert.equal(created.status, 201);
  const list = await (await call("GET", `${base}/comments?page=/`, { key: layer.key, token: "bob" })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].mine, false);

  assert.equal((await call("POST", `${base}/versions`, { key: layer.key, admin: "nope", body: {} })).status, 403);
  assert.equal((await call("POST", `${base}/versions`, { key: layer.key, admin: layer.adminKey, body: { label: "Round 2" } })).status, 201);

  assert.equal((await call("DELETE", `/api/layers/${layer.id}`, { admin: layer.key })).status, 403);
  assert.equal((await call("DELETE", `/api/layers/${layer.id}`, { admin: layer.adminKey })).status, 204);
  assert.equal((await call("GET", `/api/layers/${layer.id}`, { key: layer.key })).status, 404);
  assert.equal((await call("GET", `${base}/comments`, { key: layer.key })).status, 404);
});

test("layers are isolated from each other and from the single-tenant backend", async () => {
  const { call } = boot();
  const a = await (await call("POST", "/api/layers", { body: { name: "A" } })).json();
  const b = await (await call("POST", "/api/layers", { body: { name: "B" } })).json();
  await call("POST", `/api/l/${a.id}/comments`, { key: a.key, token: "ann", body: { page: "/", selector: "h1", x: 0.1, y: 0.1, author: "Ann", text: "Only in A" } });
  assert.equal((await (await call("GET", `/api/l/${b.id}/comments`, { key: b.key })).json()).length, 0);
  assert.equal((await (await call("GET", `/api/commentlayer/comments`)).json()).length, 0);
  assert.equal((await call("GET", `/api/l/${a.id}/comments`, { key: b.key })).status, 403);
});

test("/install sends the invite page's visitors to wherever the extension is installed from", async () => {
  const { call } = boot();
  const res = await call("GET", "/install");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://store.test/commentlayer");
});

test("the bare hostname lands on the join page's introduction", async () => {
  const { call } = boot();
  const res = await call("GET", "/");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://cl.test/join?from=site");
});

test("reading a new layer does not write to it, and a change moves its expiry", async () => {
  const { call, objects } = boot();
  const layer = await (await call("POST", "/api/layers", { body: { name: "Quiet" } })).json();
  const { storage } = objects.get(layer.id);
  const minted = structuredClone(storage.map.get("rec"));
  storage.alarm = 1;
  assert.equal((await call("GET", `/api/l/${layer.id}/comments`, { key: layer.key })).status, 200);
  assert.equal((await call("GET", `/api/l/${layer.id}/versions`, { key: layer.key })).status, 200);
  assert.deepEqual(storage.map.get("rec"), minted);
  assert.equal(storage.alarm, 1);
  await call("POST", `/api/l/${layer.id}/comments`, { key: layer.key, token: "ann", body: { page: "/", selector: "h1", x: 0.1, y: 0.1, author: "Ann", text: "First" } });
  assert.ok(storage.alarm > Date.now());
});

test("overlapping writes to one layer all land", async () => {
  const { call } = boot();
  const layer = await (await call("POST", "/api/layers", { body: { name: "Busy" } })).json();
  const post = (n) => call("POST", `/api/l/${layer.id}/comments`, { key: layer.key, token: `t${n}`, body: { page: "/", selector: "h1", x: 0.1, y: 0.1, author: `P${n}`, text: `Note ${n}` } });
  const results = await Promise.all(Array.from({ length: 12 }, (_, n) => post(n)));
  assert.ok(results.every((r) => r.status === 201));
  const list = await (await call("GET", `/api/l/${layer.id}/comments`, { key: layer.key })).json();
  assert.equal(list.length, 12);
});

test("a layer an earlier version kept in KV is picked up once, and deleting it removes both copies", async () => {
  const { kv, call } = boot();
  const sha = async (v) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  await kv.put("layer:oldlayer0001", JSON.stringify({ name: "From KV", keyHash: await sha("k"), adminHash: await sha("a"), createdAt: now, touchedAt: now, comments: [], versions: [] }));
  assert.equal((await (await call("GET", "/api/layers/oldlayer0001", { key: "k" })).json()).name, "From KV");
  assert.equal((await call("POST", "/api/l/oldlayer0001/comments", { key: "k", token: "ann", body: { page: "/", selector: "h1", x: 0.1, y: 0.1, author: "Ann", text: "Kept" } })).status, 201);
  assert.equal((await (await call("GET", "/api/l/oldlayer0001/comments", { key: "k" })).json()).length, 1);
  assert.equal((await call("DELETE", "/api/layers/oldlayer0001", { admin: "a" })).status, 204);
  assert.equal((await call("GET", "/api/layers/oldlayer0001", { key: "k" })).status, 404);
});

test("the single-tenant backend keeps its notes", async () => {
  const { call } = boot();
  assert.equal((await call("POST", "/api/commentlayer/comments", { token: "ann", body: { page: "/", selector: "h1", x: 0.1, y: 0.1, author: "Ann", text: "Embed note" } })).status, 201);
  const list = await (await call("GET", "/api/commentlayer/comments?page=/")).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].text, "Embed note");
});
