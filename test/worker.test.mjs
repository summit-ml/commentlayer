import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";

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

const boot = () => {
  const kv = fakeKV();
  const env = { COMMENTS: kv };
  const call = (method, path, { body, key, token, admin } = {}) =>
    worker.fetch(new Request(`https://cl.test${path}`, { method, headers: { "Content-Type": "application/json", ...(key ? { "X-Layer-Key": key } : {}), ...(token ? { "X-Comment-Token": token } : {}), ...(admin ? { "X-Comment-Admin": admin } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { kv, call };
};

test("mints a layer with an invite key and an admin key, and a sliding 30-day TTL", async () => {
  const { kv, call } = boot();
  const res = await call("POST", "/api/layers", { body: { name: "Website redesign" } });
  assert.equal(res.status, 201);
  const layer = await res.json();
  assert.equal(layer.name, "Website redesign");
  assert.match(layer.id, /^[A-Za-z0-9_-]{12}$/);
  assert.ok(layer.key.length >= 20 && layer.adminKey.length >= 20 && layer.key !== layer.adminKey);
  assert.equal(layer.ttlDays, 30);
  assert.equal(kv.puts.at(-1).opts.expirationTtl, 30 * 86_400);
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
