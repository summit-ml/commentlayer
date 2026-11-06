import { createCommentStore, createHandler, sha256, type Persistence, type StoreData } from "../../src/core.ts";

/**
 * CommentLayer on Cloudflare Workers.
 *
 * Hosted layers: `POST /api/layers` mints a layer (id, invite key, admin key) and every
 * comment route lives under `/api/l/<id>/…` behind the `X-Layer-Key` header.
 *
 * Each layer is one Durable Object (`Layer`), so every reader and writer of a layer goes
 * through the same instance and sees the same data wherever they are. Workers KV, which held
 * layers before, serves reads from each location's cache for up to a minute; with a whole
 * record written back on every change, a teammate in another region could overwrite a note
 * that had just been posted. A layer disappears LAYER_TTL_DAYS after its last change, by alarm.
 *
 * `/api/commentlayer/*` is the single-tenant backend for people who deploy their own Worker,
 * with the optional ADMIN_TOKEN secret. It lives in one Durable Object of the same class.
 *
 * KV is still bound, read-only in effect: a layer (or the single-tenant data) written by an
 * earlier version is picked up from it the first time it is asked for.
 *
 * The invite page (`/join`) and the privacy policy (`/privacy`) are static assets from
 * `worker/pages`; `/install` sends people on to wherever the extension is installed from, and
 * the bare hostname lands on the join page, which introduces CommentLayer when there is no invite.
 */

type Env = { COMMENTS: KVNamespace; LAYERS: DurableObjectNamespace; STORE_URL: string; ADMIN_TOKEN?: string; LAYER_TTL_DAYS?: string };

type LayerRecord = StoreData & { name: string; keyHash: string; adminHash: string; createdAt: string; touchedAt: string };

const DAY = 86_400;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const SINGLE = "single-tenant";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Comment-Token, X-Comment-Admin, X-Layer-Key",
};

const rand = (bytes: number) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ...CORS } });
const gone = () => json({ error: "That layer doesn't exist or has expired." }, 404);
const ttlSeconds = (env: Env) => DAY * (Number(env.LAYER_TTL_DAYS) || 30);

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/install") return Response.redirect(env.STORE_URL, 302);
    if (url.pathname === "/") return Response.redirect(new URL("/join?from=site", url).href, 302);

    // The Worker picks the operation and the object; nothing in the request can choose either.
    const send = (name: string, op: string, rest = "") =>
      env.LAYERS.get(env.LAYERS.idFromName(name)).fetch(new Request(`https://layer/${op}/${name}${rest}${url.search}`, req));

    if (url.pathname === "/api/layers" && req.method === "POST") return send(rand(9), "mint");

    const one = url.pathname.match(/^\/api\/layers\/([^/]+)$/);
    if (one) return ID.test(one[1]) ? send(one[1], "info") : gone();

    const scoped = url.pathname.match(/^\/api\/l\/([^/]+)(\/.*)?$/);
    if (scoped) return ID.test(scoped[1]) ? send(scoped[1], "notes", scoped[2] ?? "") : gone();

    if (url.pathname.startsWith("/api/commentlayer")) return send(SINGLE, "single", url.pathname.slice("/api/commentlayer".length));

    return json({ error: "Not found." }, 404);
  },
};

/** One layer's notes and rounds (or, under the name SINGLE, the single-tenant backend's). */
export class Layer {
  state: DurableObjectState;
  env: Env;
  queue: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // One request at a time: each reads the record, changes it and writes it back, so two that overlapped would lose a change.
  fetch(req: Request): Promise<Response> {
    const run = this.queue.then(() => this.handle(req));
    this.queue = run.catch(() => {});
    return run;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const [, op, id] = url.pathname.split("/");
    const { storage } = this.state;
    const ttl = ttlSeconds(this.env);

    if (op === "single") {
      const persistence: Persistence = {
        load: async () => (await storage.get<StoreData>("data")) ?? (await this.env.COMMENTS.get<StoreData>("data", "json")),
        save: (data) => storage.put("data", data),
      };
      return createHandler(() => createCommentStore({ persistence, adminToken: this.env.ADMIN_TOKEN }), { base: `/single/${id}`, cors: true })(req);
    }

    const save = async (rec: LayerRecord) => {
      rec.touchedAt = new Date().toISOString();
      await storage.put("rec", rec);
      await storage.setAlarm(Date.now() + ttl * 1000);
    };
    const pub = (rec: LayerRecord) => ({ id, name: rec.name, createdAt: rec.createdAt, expiresAt: new Date(Date.parse(rec.touchedAt) + ttl * 1000).toISOString(), ttlDays: ttl / DAY });

    let rec = await storage.get<LayerRecord>("rec");

    if (op === "mint") {
      if (rec) return json({ error: "That layer already exists." }, 409);
      const body = ((await req.json().catch(() => ({}))) ?? {}) as { name?: unknown };
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Shared layer";
      const key = rand(18);
      const adminKey = rand(18);
      const now = new Date().toISOString();
      // The first round is made here so that reading a new layer never has to write to it.
      rec = { name, keyHash: await sha256(key), adminHash: await sha256(adminKey), createdAt: now, touchedAt: now, comments: [], versions: [{ id: "r1", label: "Round 1", createdAt: now }] };
      await save(rec);
      return json({ ...pub(rec), key, adminKey }, 201);
    }

    if (!rec) {
      const earlier = await this.env.COMMENTS.get<LayerRecord>(`layer:${id}`, "json");
      if (!earlier) return gone();
      rec = earlier;
      await save(rec);
    }
    const layer = rec;
    const admin = req.headers.get("x-comment-admin") || "";
    const isAdmin = (await sha256(admin)) === layer.adminHash;
    const keyOk = (await sha256(req.headers.get("x-layer-key") || "")) === layer.keyHash;

    if (op === "info") {
      if (req.method === "GET") return keyOk ? json(pub(layer)) : json({ error: "That invite link isn't valid for this layer." }, 403);
      if (req.method === "DELETE") {
        if (!isAdmin) return json({ error: "Only the person who created the layer can delete it." }, 403);
        await this.remove(id);
        return new Response(null, { status: 204, headers: CORS });
      }
      return json({ error: "Not found." }, 404);
    }

    if (!keyOk) return json({ error: "That invite link isn't valid for this layer." }, 403);
    const persistence: Persistence = {
      load: async () => layer,
      save: (data) => save(Object.assign(layer, data)),
    };
    return createHandler(() => createCommentStore({ persistence, adminToken: isAdmin ? admin : undefined }), { base: `/notes/${id}`, cors: true })(req);
  }

  async remove(id: string) {
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    await this.env.COMMENTS.delete(`layer:${id}`);
  }

  // Set to LAYER_TTL_DAYS after each change. A change moves it, so when it fires the layer has been quiet that long.
  async alarm() {
    const rec = await this.state.storage.get<LayerRecord>("rec");
    if (!rec) return;
    const due = Date.parse(rec.touchedAt) + ttlSeconds(this.env) * 1000;
    if (Date.now() < due) await this.state.storage.setAlarm(due);
    else await this.state.storage.deleteAll();
  }
}
