# CommentLayer

Drop a pin, leave a note. Review comments on any website, stored wherever you choose.
MIT licensed. Built by [Summit ML](https://summitml.com/products/open-source).

**What reviewers get.** A bar at the bottom of every page with a "Turn on" button. They enter
a name once (no account), then click anything on the page to drop a numbered pin and leave a
note. "Comments" opens a drawer listing every note across the site with jump links and CSV and
JSON export. Anyone can resolve a note; only its author can edit or delete it, tracked by a
random token in their browser. Comments are grouped into review rounds; an admin can start or
rename rounds, and older rounds are viewable read-only.

## Three ways to use it

### 1. Embed on your own site

```html
<link rel="stylesheet" href="/commentlayer/commentlayer.css">
<script src="/commentlayer/commentlayer.js" data-api="/api/commentlayer" defer></script>
```

```ts
import { createCommentStore, createHandler, filePersistence } from "@summit/commentlayer";

const store = createCommentStore({
  persistence: filePersistence(process.env.COMMENTLAYER_DATA_DIR ?? "./data"),
  adminToken: process.env.COMMENTLAYER_ADMIN_TOKEN,
});
export const handle = createHandler(() => store, { base: "/api/commentlayer" });
```

`handle` takes a Fetch `Request` and returns a `Response`, so it mounts in a Next route handler,
Hono, Bun, Deno, or Express through an adapter. `CLIENT_DIR` points at the overlay files for
whatever serves static assets.

### 2. Deploy the backend to Cloudflare (free)

`worker/` is a Worker with KV storage. See [worker/README.md](worker/README.md). Three commands,
runs on the free tier, serves the overlay files too so you can embed from anywhere.

### 3. Browser extension

`pnpm build` writes `extension/dist`. In Chrome: Extensions → Developer mode → Load unpacked →
pick that folder. Open the extension's options, paste your backend URL (for example
`https://commentlayer.<you>.workers.dev/api/commentlayer`) and your name. Click the toolbar icon
on any site to turn CommentLayer on there; click again to turn it off. Pages are keyed by host
and path, so one backend serves every site the team reviews.

The extension needs a backend with CORS enabled (the Worker has it) or any backend at all,
since requests go through the extension's service worker.

## Pieces

- `client/commentlayer.js`, `client/commentlayer.css`: the overlay. Framework-free. Re-keys on
  history navigation, so single-page apps work. Themed with `--cl-*` custom properties.
- `src/core.ts`: `createCommentStore({ persistence, adminToken })`, `createHandler(getStore,
  { base, cors })`, `memoryPersistence()`, `sha256()`. No Node imports; runs anywhere.
- `src/index.ts`: the Node entry. Re-exports core and adds `filePersistence(dir)` and `CLIENT_DIR`.
- `worker/`: Cloudflare Worker with `kvPersistence`.
- `extension/src/`: Manifest V3 extension. `bridge.js` hands the overlay its config, a fetch that
  goes through the service worker, and storage shared across sites.
- `test/`: `pnpm test` runs the core through the handler with the Node test runner.

## Host configuration

The overlay reads `window.CommentLayerConfig` if a host sets it before the script runs: an object
or a promise of one with `api`, `fetch(url, init)`, `storage { get, set }`, and `scopeHost`. A
promise resolving to `null` means "not on this page". The script's `data-api` attribute wins over
`config.api`.

## API

Relative to the base: `GET/POST comments`, `PATCH/DELETE comments/:id`, `GET comments.csv`,
`GET/POST versions`, `PATCH versions/:id`. Owner identity is the `X-Comment-Token` header, hashed
before storage. Admin actions need `X-Comment-Admin`, which the overlay sends after a visit to any
page at `#cl-admin=<token>`.

## Writing a persistence adapter

```ts
const persistence: Persistence = {
  load: async () => JSON.parse(await readSomewhere()) ?? null,
  save: async (data) => writeSomewhere(JSON.stringify(data)),
};
```

`data` is `{ comments, versions }`. The store loads once per `createCommentStore` call and writes
the whole set on every change, which is right for review-sized data and wrong for a product with
thousands of users.
