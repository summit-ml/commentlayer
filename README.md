<img src="brand/wordmark.svg" alt="commentLayer" width="300" height="48">

# CommentLayer

Drop a pin, leave a note. Private review comments on any website: only the people with your
invite link see them, and nothing is ever posted publicly. MIT licensed. Built by [Summit ML](https://summitml.com/products/open-source).

```sh
git clone https://github.com/summit-ml/commentlayer
cd commentlayer && npm install && npm test && npm run build
```

**What reviewers get.** A small pill in the bottom-right corner that says how many notes are on
the page. Hovering (or tapping) grows a panel out of it: a switch to turn commenting on, the
page's notes with jump links, and a footer with the full drawer, export, and the review round.
Reviewers enter a name once (no account), then click anything on the page to drop a numbered
pin and leave a note. Anyone can resolve a note; only its author can edit or delete it, tracked
by a random token in their browser. Comments are grouped into review rounds; an admin can start
or rename rounds, and older rounds are viewable read-only.

## Three ways to use it

### 1. Embed on your own site

```html
<link rel="stylesheet" href="/commentlayer/commentlayer.css">
<script src="/commentlayer/commentlayer.js" data-api="/api/commentlayer" defer></script>
```

```ts
import { createCommentStore, createHandler, filePersistence } from "commentlayer";

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

### 3. Browser extension (the free way)

`npm run build` writes `extension/dist`. In Chrome: Extensions → Developer mode → Load unpacked →
pick that folder. Then open the extension's options.

**Hosted layers.** Type a name, click "Create layer", done: no sign-in, no setup. Click the
toolbar icon on any site to turn the layer on there, then drop pins. To invite teammates, click
"Copy invite" and send the link. It opens a join page at `summitml.com/commentlayer/join`: with
the extension installed, the layer is added on the spot; without it, the page says how to
install and then finishes the join when they come back. Access control is the link itself, the
same way a shared Figma or Loom link works. The creator is the layer's admin (rounds, moderation,
deletion) without typing a token.

Hosted layers live on the Worker in `worker/` (Summit ML runs it at `HOSTED_API`, set in
`extension/src/background.ts`). Each layer is one KV value, written with a sliding TTL: a layer
is deleted 30 days after its last note. Export CSV or JSON from the overlay any time, or delete
the layer early from the options page.

Every note records where it was left: the page, a CSS path to the clicked element, the point
inside that element as fractions of its width and height, the element's tag and a short text
snippet, and the viewport size at the time. All of it is in the JSON and CSV exports. "Copy for
AI" in the Export menu writes the current round as markdown with those details per note, so an
assistant (or a ticket) can find each pin without a screenshot.

**Google Sheet layers (advanced).** Under "Advanced", "Create sheet" signs in with Google and
makes a spreadsheet in your own Drive with a `comments` tab and a `rounds` tab; it never
expires and the data stays in your Drive. Share the sheet with teammates as Editor before
sending the invite; someone who opens an invite before being shared gets a "Request layer
access" button that goes through Google's own access request. The comment store runs inside
the extension and talks to the Sheets API with the reviewer's own token; see
[docs/google-setup.md](docs/google-setup.md) for the one-time OAuth client setup the publisher
does.

**Your own backend (advanced).** Also under "Advanced", paste the API base of a CommentLayer
backend you host, such as the Worker's `/api/commentlayer`, or a site with the embed. Requests
go through the extension's service worker, so the backend doesn't need CORS.

A reviewer can belong to several layers. The toolbar icon turns the *active* layer on for the
current site; the options page shows which sites each layer is on. Pages are keyed by host and
path, so one layer serves every site a team reviews. Pins from teammates appear within about
twenty seconds without a reload.

## Theming

Three brand colors drive the whole overlay: **primary** (pins, switch, accents), **secondary**
(the pill and panel background), and **tertiary** (text). Everything else is derived. They
resolve in this order, first match wins:

1. Colors a reviewer set in the panel's **Theme** view, saved per site in their browser.
2. Colors the host passes in: `data-primary`, `data-secondary`, `data-tertiary` on the script
   tag, or `theme: { primary, secondary, tertiary }` in `window.CommentLayerConfig`.
3. The host site's own custom properties on `:root`: `--primary-color`, `--color-primary`,
   `--primary`, `--brand`, `--accent`, and the secondary and tertiary equivalents.
4. The defaults: magenta on near-black.

Text and on-accent colors are picked for contrast automatically when not given, so a light
secondary gets dark text without any configuration. For finer control, override the derived
tokens (`--cl-accent`, `--cl-bg`, `--cl-fg`, `--cl-surface`, `--cl-font`, and so on) on `.cl-ui`
in the host's stylesheet. The three brand tokens themselves are written by the overlay at
runtime, so set those through the options above rather than CSS.

## Holidays

Around a handful of holidays the status dot in the pill turns into a small icon in the same
colors: a pumpkin for Halloween, a heart for Valentine's Day, a clover for St. Patrick's Day, a
star for the Fourth of July, a turkey for US Thanksgiving, a tree for Christmas, and a sparkle
for New Year's. Each shows for three days: the day before, the day of, and the day after. Force one with `data-holiday="halloween"` on
the script tag (or `holiday` in the config) to preview it, or turn them off with
`data-holiday="off"`.

## Developing

`npm run typecheck`, `npm test`, and `npm run build` (which writes `extension/dist` and copies the
overlay into `worker/public`). Node 22 or newer. The library is plain TypeScript consumed as source; only
the extension's service worker is bundled (esbuild).

## Pieces

- `client/commentlayer.js`, `client/commentlayer.css`: the overlay. Framework-free. Re-keys on
  history navigation, so single-page apps work. Themed with `--cl-*` custom properties.
- `src/core.ts`: `createCommentStore({ persistence, adminToken })`, `createHandler(getStore,
  { base, cors })`, `memoryPersistence()`, `sha256()`. No Node imports; runs anywhere.
- `src/index.ts`: the Node entry. Re-exports core and adds `filePersistence(dir)` and `CLIENT_DIR`.
- `worker/`: Cloudflare Worker. Hosted layers (`/api/layers`, `/api/l/<id>/…`, one KV value
  per layer with a sliding TTL) plus the single-tenant `/api/commentlayer` backend.
- `src/sheets.ts`: `sheetsPersistence({ spreadsheetId, token })` and `createLayerSpreadsheet()`,
  the Google Sheets adapter the extension uses. Runs anywhere `fetch` does.
- `extension/src/`: Manifest V3 extension. `background.ts` (bundled by the build) holds the
  layers, talks to the hosted Worker, signs in with Google for sheet layers and runs the core
  store in-process for those; `bridge.js` hands the overlay its config and a fetch that goes
  through the service worker.
- `test/`: `npm test` runs the core through the handler, the Sheets adapter, and the Worker's
  hosted-layer routes with the Node test runner.

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
