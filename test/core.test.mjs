import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommentStore, createHandler, memoryPersistence } from "../src/core.ts";

const boot = async () => {
  const store = await createCommentStore({ persistence: memoryPersistence(), adminToken: "admin" });
  return createHandler(() => store, { base: "/api/commentlayer", cors: true });
};
const call = (handle, method, path, { body, token, admin } = {}) =>
  handle(new Request(`https://x.test/api/commentlayer${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { "X-Comment-Token": token } : {}), ...(admin ? { "X-Comment-Admin": admin } : {}) }, body: body ? JSON.stringify(body) : undefined }));

test("starts with one round and no comments", async () => {
  const handle = await boot();
  const v = await (await call(handle, "GET", "/versions")).json();
  assert.equal(v.current, "r1");
  assert.deepEqual(await (await call(handle, "GET", "/comments")).json(), []);
});

test("creates, lists, edits and deletes with owner tokens", async () => {
  const handle = await boot();
  const payload = { page: "/", selector: "h1", x: 0.5, y: 0.2, author: "Ann", text: "Tighter headline" };
  const created = await (await call(handle, "POST", "/comments", { body: payload, token: "ann" })).json();
  assert.equal(created.mine, true);
  const asBob = await (await call(handle, "GET", "/comments?page=/", { token: "bob" })).json();
  assert.equal(asBob[0].mine, false);
  const denied = await call(handle, "PATCH", `/comments/${created.id}`, { body: { text: "nope" }, token: "bob" });
  assert.equal(denied.status, 403);
  const resolved = await (await call(handle, "PATCH", `/comments/${created.id}`, { body: { resolved: true }, token: "bob" })).json();
  assert.equal(resolved.resolved, true);
  const byAdmin = await (await call(handle, "PATCH", `/comments/${created.id}`, { body: { text: "Edited by admin" }, token: "bob", admin: "admin" })).json();
  assert.equal(byAdmin.text, "Edited by admin");
  assert.equal((await call(handle, "DELETE", `/comments/${created.id}`, { token: "ann" })).status, 204);
  assert.deepEqual(await (await call(handle, "GET", "/comments")).json(), []);
});

test("rounds need the admin token and the csv export works", async () => {
  const handle = await boot();
  assert.equal((await call(handle, "POST", "/versions", { body: { label: "Round 2" } })).status, 403);
  const r2 = await (await call(handle, "POST", "/versions", { body: { label: "Round 2" }, admin: "admin" })).json();
  assert.equal(r2.id, "r2");
  await call(handle, "POST", "/comments", { body: { page: "/about", selector: "p", x: 0.1, y: 0.1, author: "Ann", text: 'Says "hi"' }, token: "ann" });
  const csv = await (await call(handle, "GET", "/comments.csv")).text();
  assert.match(csv, /"Round 2","\/about","Ann"/);
  assert.match(csv, /"Says ""hi"""/);
});

test("validates input and answers preflight", async () => {
  const handle = await boot();
  assert.equal((await call(handle, "POST", "/comments", { body: { page: "/" }, token: "ann" })).status, 400);
  assert.equal((await call(handle, "GET", "/nope")).status, 404);
  const pre = await call(handle, "OPTIONS", "/comments");
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("votes are one per person, exclusive, and come back as counts only", async () => {
  const handle = await boot();
  const c = await (await call(handle, "POST", "/comments", { body: { page: "/", selector: "h1", x: 0.5, y: 0.2, author: "Ann", text: "Nice" }, token: "ann" })).json();
  let r = await (await call(handle, "POST", `/comments/${c.id}/vote`, { body: { vote: "up" }, token: "bob" })).json();
  assert.deepEqual(r.votes, { up: 1, down: 0 });
  assert.equal(r.myVote, "up");
  r = await (await call(handle, "POST", `/comments/${c.id}/vote`, { body: { vote: "up" }, token: "ann" })).json();
  assert.deepEqual(r.votes, { up: 2, down: 0 });
  r = await (await call(handle, "POST", `/comments/${c.id}/vote`, { body: { vote: "down" }, token: "bob" })).json();
  assert.deepEqual(r.votes, { up: 1, down: 1 });
  assert.equal(r.myVote, "down");
  r = await (await call(handle, "POST", `/comments/${c.id}/vote`, { body: { vote: "down" }, token: "bob" })).json();
  assert.deepEqual(r.votes, { up: 1, down: 0 });
  assert.equal(r.myVote, null);
  assert.equal((await call(handle, "POST", `/comments/${c.id}/vote`, { body: { vote: "sideways" }, token: "bob" })).status, 400);
  const asCarol = await (await call(handle, "GET", "/comments", { token: "carol" })).json();
  assert.deepEqual(asCarol[0].votes, { up: 1, down: 0 });
  assert.equal(asCarol[0].myVote, null);
  assert.equal("reactions" in asCarol[0], false);
});

test("keeps what was clicked: tag, snippet and viewport, in the api and the csv", async () => {
  const handle = await boot();
  const body = { page: "/", selector: "main>h1:nth-of-type(1)", x: 0.25, y: 0.5, px: 300, py: 120, tag: "h1", snippet: "Modern, AI-first engineering", vw: 1440, vh: 900, author: "Ann", text: "Shorter" };
  const created = await (await call(handle, "POST", "/comments", { body, token: "ann" })).json();
  assert.equal(created.tag, "h1");
  assert.equal(created.snippet, "Modern, AI-first engineering");
  assert.equal(created.vw, 1440);
  const bare = await (await call(handle, "POST", "/comments", { body: { page: "/", selector: "p", x: 0, y: 0, author: "Bob", text: "Old client" }, token: "bob" })).json();
  assert.equal(bare.tag, null);
  const csv = await (await call(handle, "GET", "/comments.csv")).text();
  assert.match(csv, /"text","element","snippet","selector","x","y","viewport"/);
  assert.match(csv, /"Shorter","h1","Modern, AI-first engineering","main>h1:nth-of-type\(1\)","0.25","0.5","1440x900"/);
});
