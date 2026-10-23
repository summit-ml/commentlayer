import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * CommentLayer: review comments pinned to any page.
 *
 * - `client/commentlayer.js` and `client/commentlayer.css` are the overlay. Include them
 *   on a page with `<script src=".../commentlayer.js" data-api="/api/commentlayer" defer>`.
 * - `createCommentStore()` keeps comments and review rounds in two JSON files.
 * - `createHandler(store)` turns a Fetch `Request` into a `Response` for the API the
 *   overlay talks to, so it mounts in any runtime that speaks web requests.
 */

/** Absolute path to the overlay's static files, for whatever serves them. */
export const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

export type Comment = {
  id: string;
  page: string;
  selector: string;
  x: number;
  y: number;
  px: number | null;
  py: number | null;
  author: string;
  text: string;
  createdAt: string;
  updatedAt: string | null;
  resolved: boolean;
  version: string;
  owner: string;
};

export type Round = { id: string; label: string; createdAt: string };

export type StoreOptions = {
  /** Directory for comments.json and versions.json. */
  dataDir: string;
  /** Lets one browser edit or delete every comment after visiting `#cl-admin=<token>`. */
  adminToken?: string;
};

const hash = (token: string) => crypto.createHash("sha256").update(String(token)).digest("hex");
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function createCommentStore({ dataDir, adminToken = "" }: StoreOptions) {
  const FILE = path.join(dataDir, "comments.json");
  const VFILE = path.join(dataDir, "versions.json");
  fs.mkdirSync(dataDir, { recursive: true });

  let comments: Comment[] = [];
  let versions: Round[] = [];
  try {
    comments = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    comments = [];
  }
  try {
    versions = JSON.parse(fs.readFileSync(VFILE, "utf8"));
  } catch {
    versions = [];
  }

  let writing: Promise<unknown> = Promise.resolve();
  const writeJson = (file: string, data: unknown) =>
    fs.promises.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2)).then(() => fs.promises.rename(`${file}.tmp`, file));
  const save = () => {
    writing = writing.then(() => Promise.all([writeJson(FILE, comments), writeJson(VFILE, versions)]));
    return writing;
  };

  const current = () => versions[versions.length - 1];
  const startRound = (label?: string | null): Round => {
    const round = { id: `r${versions.length + 1}`, label: label || `Round ${versions.length + 1}`, createdAt: new Date().toISOString() };
    versions.push(round);
    return round;
  };
  if (!versions.length) {
    const first = startRound("Round 1");
    if (comments.length) {
      first.createdAt = comments.map((c) => c.createdAt).sort()[0];
      comments.forEach((c) => {
        if (!c.version) c.version = first.id;
      });
      startRound("Round 2");
    }
    void save();
  }
  comments.forEach((c) => {
    if (!c.version) c.version = versions[0].id;
  });

  const isAdmin = (admin: string | null) => !!adminToken && admin === adminToken;
  const owns = (c: Comment, token: string | null, admin: string | null) => isAdmin(admin) || (!!token && c.owner === hash(token));
  const pub = (c: Comment, token: string | null, admin = false) => ({
    id: c.id,
    page: c.page,
    selector: c.selector,
    x: c.x,
    y: c.y,
    px: c.px,
    py: c.py,
    author: c.author,
    text: c.text,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolved: !!c.resolved,
    version: c.version,
    mine: admin || (!!token && c.owner === hash(token)),
  });

  return {
    isAdmin,
    list(opts: { page?: string | null; version?: string | null; token: string | null; admin: string | null }) {
      let list = opts.page ? comments.filter((c) => c.page === opts.page) : comments;
      if (opts.version) list = list.filter((c) => c.version === opts.version);
      return list.map((c) => pub(c, opts.token, isAdmin(opts.admin)));
    },
    csv() {
      const label = (id: string) => versions.find((v) => v.id === id)?.label ?? id;
      const rows: unknown[][] = [["id", "round", "page", "author", "createdAt", "updatedAt", "resolved", "text"]];
      comments.forEach((c) => rows.push([c.id, label(c.version), c.page, c.author, c.createdAt, c.updatedAt ?? "", c.resolved ? "yes" : "no", c.text]));
      return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    },
    versions() {
      return {
        current: current().id,
        versions: versions.map((v) => ({
          ...v,
          count: comments.filter((c) => c.version === v.id).length,
          open: comments.filter((c) => c.version === v.id && !c.resolved).length,
        })),
      };
    },
    async addRound(label: unknown) {
      const round = startRound(str(label, 80));
      await save();
      return round;
    },
    async renameRound(id: string, label: unknown) {
      const v = versions.find((item) => item.id === id);
      if (!v) return { error: "Not found.", status: 404 } as const;
      const next = str(label, 80);
      if (!next) return { error: "A label is required.", status: 400 } as const;
      v.label = next;
      await save();
      return v;
    },
    async create(body: Record<string, unknown>, token: string | null) {
      const t = str(token ?? "", 200);
      const page = str(body.page, 200);
      const selector = str(body.selector, 2000);
      const author = str(body.author, 80);
      const text = str(body.text, 4000);
      const x = num(body.x);
      const y = num(body.y);
      if (!t || !page || !selector || !author || !text || x === null || y === null) return { error: "Missing or invalid fields.", status: 400 } as const;
      const now = new Date().toISOString();
      const c: Comment = { id: crypto.randomUUID(), page, selector, x, y, px: num(body.px), py: num(body.py), author, text, createdAt: now, updatedAt: null, resolved: false, version: current().id, owner: hash(t) };
      comments.push(c);
      await save();
      return pub(c, t);
    },
    async update(id: string, body: Record<string, unknown>, token: string | null, admin: string | null) {
      const c = comments.find((item) => item.id === id);
      if (!c) return { error: "Not found.", status: 404 } as const;
      if (body.text !== undefined) {
        if (!owns(c, token, admin)) return { error: "Only the author can edit this comment.", status: 403 } as const;
        const text = str(body.text, 4000);
        if (!text) return { error: "Comment text is required.", status: 400 } as const;
        c.text = text;
        c.updatedAt = new Date().toISOString();
      }
      if (body.resolved !== undefined) c.resolved = !!body.resolved;
      await save();
      return pub(c, token, isAdmin(admin));
    },
    async remove(id: string, token: string | null, admin: string | null) {
      const index = comments.findIndex((item) => item.id === id);
      if (index === -1) return { error: "Not found.", status: 404 } as const;
      if (!owns(comments[index], token, admin)) return { error: "Only the author can delete this comment.", status: 403 } as const;
      comments.splice(index, 1);
      await save();
      return null;
    },
  };
}

export type CommentStore = ReturnType<typeof createCommentStore>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" } });
const isErr = (r: unknown): r is { error: string; status: number } => !!r && typeof r === "object" && "error" in (r as object);

/**
 * Routes, relative to wherever the handler is mounted (the overlay's `data-api`):
 * GET/POST comments · PATCH/DELETE comments/:id · GET comments.csv ·
 * GET/POST versions · PATCH versions/:id
 */
export function createHandler(store: CommentStore, base = "/api/commentlayer") {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    const parts = rel.split("/").filter(Boolean);
    const token = req.headers.get("x-comment-token");
    const admin = req.headers.get("x-comment-admin");
    const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const [head, id] = parts;

    if (head === "comments.csv" && req.method === "GET") {
      return new Response(store.csv(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="comments.csv"', "Cache-Control": "no-cache" } });
    }
    if (head === "versions") {
      if (req.method === "GET" && !id) return json(store.versions());
      if (req.method === "POST" && !id) {
        if (!store.isAdmin(admin)) return json({ error: "Only the admin can start a new round." }, 403);
        return json(await store.addRound((await body()).label), 201);
      }
      if (req.method === "PATCH" && id) {
        if (!store.isAdmin(admin)) return json({ error: "Only the admin can rename a round." }, 403);
        const r = await store.renameRound(id, (await body()).label);
        return isErr(r) ? json({ error: r.error }, r.status) : json(r);
      }
    }
    if (head === "comments") {
      if (req.method === "GET" && !id) return json(store.list({ page: url.searchParams.get("page"), version: url.searchParams.get("version"), token, admin }));
      if (req.method === "POST" && !id) {
        const r = await store.create(await body(), token);
        return isErr(r) ? json({ error: r.error }, r.status) : json(r, 201);
      }
      if (req.method === "PATCH" && id) {
        const r = await store.update(id, await body(), token, admin);
        return isErr(r) ? json({ error: r.error }, r.status) : json(r);
      }
      if (req.method === "DELETE" && id) {
        const r = await store.remove(id, token, admin);
        return isErr(r) ? json({ error: r.error }, r.status) : new Response(null, { status: 204 });
      }
    }
    return json({ error: "Not found." }, 404);
  };
}
