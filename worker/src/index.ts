import { createCommentStore, createHandler, sha256, type Persistence, type StoreData } from "../../src/core.ts";

/**
 * CommentLayer on Cloudflare Workers.
 *
 * Hosted layers: `POST /api/layers` mints a layer (id, invite key, admin key) and every
 * comment route lives under `/api/l/<id>/…` behind the `X-Layer-Key` header. One KV value per
 * layer, written with a sliding TTL so a layer disappears LAYER_TTL_DAYS after its last note.
 *
 * `/api/commentlayer/*` is the single-tenant backend for people who deploy their own Worker;
 * it keeps the `data` key and the optional ADMIN_TOKEN secret from earlier versions.
 */

type Env = { COMMENTS: KVNamespace; ADMIN_TOKEN?: string; LAYER_TTL_DAYS?: string };

type LayerRecord = StoreData & { name: string; keyHash: string; adminHash: string; createdAt: string; touchedAt: string };

const DAY = 86_400;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
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

const legacyPersistence = (kv: KVNamespace): Persistence => ({
  load: () => kv.get("data", "json"),
  save: (data) => kv.put("data", JSON.stringify(data)),
});

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: CORS });

    const ttl = DAY * (Number(env.LAYER_TTL_DAYS) || 30);
    const kv = env.COMMENTS;
    const get = (id: string) => kv.get<LayerRecord>(`layer:${id}`, "json");
    const put = (id: string, rec: LayerRecord) => kv.put(`layer:${id}`, JSON.stringify({ ...rec, touchedAt: new Date().toISOString() }), { expirationTtl: ttl });
    const pub = (id: string, rec: LayerRecord) => ({ id, name: rec.name, createdAt: rec.createdAt, expiresAt: new Date(Date.parse(rec.touchedAt) + ttl * 1000).toISOString(), ttlDays: ttl / DAY });
    const keyOk = async (rec: LayerRecord) => (await sha256(req.headers.get("x-layer-key") || "")) === rec.keyHash;
    const adminHeader = () => req.headers.get("x-comment-admin") || "";

    if (url.pathname === "/api/layers" && req.method === "POST") {
      const body = ((await req.json().catch(() => ({}))) ?? {}) as { name?: unknown };
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Shared layer";
      const id = rand(9);
      const key = rand(18);
      const adminKey = rand(18);
      const now = new Date().toISOString();
      const rec: LayerRecord = { name, keyHash: await sha256(key), adminHash: await sha256(adminKey), createdAt: now, touchedAt: now, comments: [], versions: [] };
      await put(id, rec);
      return json({ ...pub(id, rec), key, adminKey }, 201);
    }

    const one = url.pathname.match(/^\/api\/layers\/([^/]+)$/);
    if (one) {
      const id = one[1];
      const rec = ID.test(id) ? await get(id) : null;
      if (!rec) return json({ error: "That layer doesn't exist or has expired." }, 404);
      if (req.method === "GET") {
        if (!(await keyOk(rec))) return json({ error: "That invite link isn't valid for this layer." }, 403);
        return json(pub(id, rec));
      }
      if (req.method === "DELETE") {
        if ((await sha256(adminHeader())) !== rec.adminHash) return json({ error: "Only the person who created the layer can delete it." }, 403);
        await kv.delete(`layer:${id}`);
        return new Response(null, { status: 204, headers: CORS });
      }
      return json({ error: "Not found." }, 404);
    }

    const scoped = url.pathname.match(/^\/api\/l\/([^/]+)(?:\/|$)/);
    if (scoped) {
      const id = scoped[1];
      const rec = ID.test(id) ? await get(id) : null;
      if (!rec) return json({ error: "That layer doesn't exist or has expired." }, 404);
      if (!(await keyOk(rec))) return json({ error: "That invite link isn't valid for this layer." }, 403);
      const admin = adminHeader();
      const adminToken = admin && (await sha256(admin)) === rec.adminHash ? admin : undefined;
      const persistence: Persistence = {
        load: async () => rec,
        save: (data) => put(id, { ...rec, ...data }),
      };
      const handle = createHandler(() => createCommentStore({ persistence, adminToken }), { base: `/api/l/${id}`, cors: true });
      return handle(req);
    }

    if (url.pathname.startsWith("/api/commentlayer")) {
      const handle = createHandler(() => createCommentStore({ persistence: legacyPersistence(kv), adminToken: env.ADMIN_TOKEN }), { base: "/api/commentlayer", cors: true });
      return handle(req);
    }

    return json({ error: "Not found." }, 404);
  },
};
