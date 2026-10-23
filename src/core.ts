/**
 * CommentLayer core: the comment store and the request handler. Runtime-agnostic, so it
 * runs in Node, Cloudflare Workers, Deno, or Bun. Persistence is pluggable.
 */

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
  /** Vote → hashed owner tokens of the people who cast it. Only counts ever leave the store. */
  reactions?: Record<string, string[]>;
};

export const VOTES = ["up", "down"] as const;

export type Round = { id: string; label: string; createdAt: string };

export type StoreData = { comments: Comment[]; versions: Round[] };

/** Where the data lives. Both functions see the whole dataset. */
export type Persistence = {
  load(): Promise<Partial<StoreData> | null | undefined>;
  save(data: StoreData): Promise<void>;
};

export type StoreOptions = {
  persistence: Persistence;
  /** Lets one browser edit or delete every comment after visiting `#cl-admin=<token>`. */
  adminToken?: string;
};

/** Keeps everything in memory; useful for tests and local experiments. */
export function memoryPersistence(initial: Partial<StoreData> = {}): Persistence {
  let data: StoreData = { comments: initial.comments ?? [], versions: initial.versions ?? [] };
  return {
    async load() {
      return data;
    },
    async save(next) {
      data = structuredClone(next);
    },
  };
}

export async function sha256(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export type StoreError = { error: string; status: number };
export const isStoreError = (r: unknown): r is StoreError => !!r && typeof r === "object" && "error" in (r as object);

/**
 * Loads the data once and keeps it in memory. Token arguments are already-hashed owner
 * tokens (see `sha256`); the handler does the hashing.
 */
export async function createCommentStore({ persistence, adminToken = "" }: StoreOptions) {
  const loaded = (await persistence.load()) ?? {};
  const comments: Comment[] = Array.isArray(loaded.comments) ? loaded.comments : [];
  const versions: Round[] = Array.isArray(loaded.versions) ? loaded.versions : [];

  let writing: Promise<unknown> = Promise.resolve();
  const save = () => {
    writing = writing.then(() => persistence.save({ comments, versions }));
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
    await save();
  }
  comments.forEach((c) => {
    if (!c.version) c.version = versions[0].id;
  });

  const isAdmin = (admin: string | null) => !!adminToken && admin === adminToken;
  const owns = (c: Comment, tokenHash: string | null, admin: string | null) => isAdmin(admin) || (!!tokenHash && c.owner === tokenHash);
  const pub = (c: Comment, tokenHash: string | null, admin = false) => ({
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
    mine: admin || (!!tokenHash && c.owner === tokenHash),
    votes: { up: (c.reactions?.up ?? []).length, down: (c.reactions?.down ?? []).length },
    myVote: (VOTES as readonly string[]).find((v) => !!tokenHash && (c.reactions?.[v] ?? []).includes(tokenHash)) ?? null,
  });

  return {
    isAdmin,
    list(opts: { page?: string | null; version?: string | null; tokenHash: string | null; admin: string | null }) {
      let list = opts.page ? comments.filter((c) => c.page === opts.page) : comments;
      if (opts.version) list = list.filter((c) => c.version === opts.version);
      return list.map((c) => pub(c, opts.tokenHash, isAdmin(opts.admin)));
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
    async renameRound(id: string, label: unknown): Promise<Round | StoreError> {
      const v = versions.find((item) => item.id === id);
      if (!v) return { error: "Not found.", status: 404 };
      const next = str(label, 80);
      if (!next) return { error: "A label is required.", status: 400 };
      v.label = next;
      await save();
      return v;
    },
    async create(body: Record<string, unknown>, tokenHash: string | null) {
      const page = str(body.page, 200);
      const selector = str(body.selector, 2000);
      const author = str(body.author, 80);
      const text = str(body.text, 4000);
      const x = num(body.x);
      const y = num(body.y);
      if (!tokenHash || !page || !selector || !author || !text || x === null || y === null) return { error: "Missing or invalid fields.", status: 400 } as StoreError;
      const now = new Date().toISOString();
      const c: Comment = { id: crypto.randomUUID(), page, selector, x, y, px: num(body.px), py: num(body.py), author, text, createdAt: now, updatedAt: null, resolved: false, version: current().id, owner: tokenHash };
      comments.push(c);
      await save();
      return pub(c, tokenHash);
    },
    async update(id: string, body: Record<string, unknown>, tokenHash: string | null, admin: string | null) {
      const c = comments.find((item) => item.id === id);
      if (!c) return { error: "Not found.", status: 404 } as StoreError;
      if (body.text !== undefined) {
        if (!owns(c, tokenHash, admin)) return { error: "Only the author can edit this comment.", status: 403 } as StoreError;
        const text = str(body.text, 4000);
        if (!text) return { error: "Comment text is required.", status: 400 } as StoreError;
        c.text = text;
        c.updatedAt = new Date().toISOString();
      }
      if (body.resolved !== undefined) c.resolved = !!body.resolved;
      await save();
      return pub(c, tokenHash, isAdmin(admin));
    },
    /** Casts, switches, or withdraws a vote. One vote per person; up and down are exclusive. */
    async vote(id: string, vote: unknown, tokenHash: string | null) {
      const c = comments.find((item) => item.id === id);
      if (!c) return { error: "Not found.", status: 404 } as StoreError;
      if (!tokenHash) return { error: "Missing token.", status: 400 } as StoreError;
      if (typeof vote !== "string" || !(VOTES as readonly string[]).includes(vote)) return { error: "Unknown vote.", status: 400 } as StoreError;
      c.reactions = c.reactions ?? {};
      const had = (c.reactions[vote] ?? []).includes(tokenHash);
      for (const v of VOTES) c.reactions[v] = (c.reactions[v] ?? []).filter((t) => t !== tokenHash);
      if (!had) c.reactions[vote] = [...(c.reactions[vote] ?? []), tokenHash];
      await save();
      return pub(c, tokenHash);
    },
    async remove(id: string, tokenHash: string | null, admin: string | null) {
      const index = comments.findIndex((item) => item.id === id);
      if (index === -1) return { error: "Not found.", status: 404 } as StoreError;
      if (!owns(comments[index], tokenHash, admin)) return { error: "Only the author can delete this comment.", status: 403 } as StoreError;
      comments.splice(index, 1);
      await save();
      return null;
    },
  };
}

export type CommentStore = Awaited<ReturnType<typeof createCommentStore>>;

export type HandlerOptions = {
  /** Path prefix the handler is mounted at, stripped before routing. */
  base?: string;
  /** Adds permissive CORS headers so the browser extension and cross-origin embeds can call it. */
  cors?: boolean;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Comment-Token, X-Comment-Admin",
  "Access-Control-Max-Age": "86400",
};

/**
 * Routes, relative to `base` (the overlay's `data-api`):
 * GET/POST comments · PATCH/DELETE comments/:id · POST comments/:id/vote · GET comments.csv ·
 * GET/POST versions · PATCH versions/:id
 *
 * `getStore` is called per request so a runtime without a persistent process (a Worker) can
 * reload from storage each time; a long-lived server passes `() => store`.
 */
export function createHandler(getStore: () => CommentStore | Promise<CommentStore>, { base = "/api/commentlayer", cors = false }: HandlerOptions = {}) {
  const extra = cors ? CORS : {};
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ...extra } });

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: extra });
    const store = await getStore();
    const url = new URL(req.url);
    const rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    const parts = rel.split("/").filter(Boolean);
    const rawToken = req.headers.get("x-comment-token");
    const tokenHash = rawToken ? await sha256(rawToken) : null;
    const admin = req.headers.get("x-comment-admin");
    const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const [head, id, action] = parts;

    if (head === "comments.csv" && req.method === "GET") {
      return new Response(store.csv(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="comments.csv"', "Cache-Control": "no-cache", ...extra } });
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
        return isStoreError(r) ? json({ error: r.error }, r.status) : json(r);
      }
    }
    if (head === "comments") {
      if (req.method === "GET" && !id) return json(store.list({ page: url.searchParams.get("page"), version: url.searchParams.get("version"), tokenHash, admin }));
      if (req.method === "POST" && !id) {
        const r = await store.create(await body(), tokenHash);
        return isStoreError(r) ? json({ error: r.error }, r.status) : json(r, 201);
      }
      if (req.method === "POST" && id && action === "vote") {
        const r = await store.vote(id, (await body()).vote, tokenHash);
        return isStoreError(r) ? json({ error: r.error }, r.status) : json(r);
      }
      if (req.method === "PATCH" && id) {
        const r = await store.update(id, await body(), tokenHash, admin);
        return isStoreError(r) ? json({ error: r.error }, r.status) : json(r);
      }
      if (req.method === "DELETE" && id) {
        const r = await store.remove(id, tokenHash, admin);
        return isStoreError(r) ? json({ error: r.error }, r.status) : new Response(null, { status: 204, headers: extra });
      }
    }
    return json({ error: "Not found." }, 404);
  };
}
