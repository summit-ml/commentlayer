<img src="brand/wordmark.svg" alt="commentLayer" width="300" height="48">

# CommentLayer

Drop a pin, leave a note. Review comments pinned to the page itself, seen only by the people
you invite; nothing is ever posted to the site being reviewed. MIT licensed. Built by
[Summit ML](https://summitml.com/products/open-source).

```sh
npm install commentlayer
```

The package has no runtime dependencies. Or work from source:

```sh
git clone https://github.com/summit-ml/commentlayer
cd commentlayer && npm install && npm test && npm run build:extension
```

**What reviewers get.** A small pill in the bottom-right corner that says how many open notes
are on the page. Hovering (or tapping) grows a panel out of it: a switch to turn commenting on,
the page's notes with jump links, and a footer with the full drawer, export, theme, and the
review round. With a mouse, clicking the pill itself turns commenting on and off. Reviewers
enter a name once (no account), then click anything on the page to drop a numbered pin and
leave a note. Anyone can resolve a note or vote it up or down; only its author can edit or
delete it, tracked by a random token in their browser. Comments are grouped into review rounds;
an admin can start or rename rounds and edit or delete any note, and older rounds are viewable
read-only.

Every note records where it was left: the page, a CSS path to the clicked element, the point
inside that element as fractions of its width and height, the element's tag and a short label
or text snippet (up to 120 characters), and the viewport size at the time. All of it is in the
JSON and CSV exports. "Copy for AI" in the Export menu writes the current round as markdown
with those details per note, so an assistant (or a ticket) can find each pin without a
screenshot.

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
Hono, Bun, Deno, or Express through an adapter. The overlay files are in the package's `client/`
folder (`commentlayer/client/commentlayer.js` and `.css`); `CLIENT_DIR` is its absolute path,
for whatever serves static assets.

**Keep it off production.** An embed has no invite link: anyone who can open the page can read
every note and add their own. Turn it on only where reviewers work, with a switch that is off by
default. A dev/prod check is the wrong switch, because preview and staging builds usually run
as production builds.

```ts
// Set COMMENTLAYER=on on the preview or staging deployment only.
const enabled = process.env.COMMENTLAYER === "on";

// The API: without the switch, the route does not exist.
export const handle = enabled
  ? createHandler(() => store, { base: "/api/commentlayer" })
  : () => new Response(null, { status: 404 });

// The page: render the <link> and <script> tags only when `enabled` is true.
```

As a second line of defence, list the hostnames the overlay may run on. Anywhere else the script
does nothing, even if the tag ships by mistake:

```html
<script src="/commentlayer/commentlayer.js" data-api="/api/commentlayer"
        data-hosts="staging.example.com, *.preview.example.com, localhost" defer></script>
```

`data-hosts` hides the overlay; it does not close the API, so gate the route as well.

### 2. Deploy the backend to Cloudflare (free)

`worker/` is a Worker that keeps each layer in a Durable Object. See [worker/README.md](worker/README.md). Three commands,
runs on the free tier, serves the overlay files too so you can embed from anywhere.

### 3. Browser extension (the free way)

For Chrome. `npm run build:extension` writes `extension/dist`. In Chrome: Extensions → Developer
mode → Load unpacked → pick that folder. Then open the extension's options. Its permissions
are storage, scripting, and access to all sites, so it can show the overlay on whichever site
you turn it on for; until you click its toolbar icon on a site, it adds nothing to that page and
sends nothing.

**Hosted layers.** Type a name, click "Create layer", done: no sign-in, no setup. Click the
toolbar icon on any site to turn the layer on there, then drop pins. To invite teammates, click
"Copy invite" in the options, or "Share" in the drawer, and send the link. It opens a join page
at `commentlayer.summitml.com/join`: with the extension installed, one click on "Join this layer"
adds it; without it, the page says how to install and picks up when they come back. Nothing is
joined just by opening a link.
Access control is the link itself, the same way a shared Figma or Loom link works. The creator
is the layer's admin (rounds, moderation, deletion) without typing a token.

Hosted layers live on the Worker in `worker/` (Summit ML runs it at `HOSTED_API`, set in
`extension/src/background.ts`). Each layer is one Durable Object, so teammates anywhere see the same notes at once: a layer
is deleted 30 days after its last change (a note, an edit, a vote, a resolve, a round). Export CSV or JSON from the overlay any time, or delete
the layer early from the options page. What is stored, and for how long, is spelled out in the
[privacy policy](https://commentlayer.summitml.com/privacy).

**Your own backend (advanced).** Under "Advanced" in the options, paste the API base of a
CommentLayer backend you host, such as the Worker's `/api/commentlayer`, or a site with the
embed. Requests go through the extension's service worker, so the backend doesn't need CORS.
Notes on that layer go to your backend and never reach Summit ML.

A reviewer can belong to several layers. The toolbar icon turns the *active* layer on for the
current site; the options page shows which sites each layer is on. Pages are keyed by host and
path, so one layer serves every site a team reviews. Pins from teammates appear within about
twenty seconds without a reload.

**Google Sheet layers are not in the current extension.** Earlier builds could keep a layer in
a Google Sheet in the reviewer's own Drive. The Web Store build drops the Google sign-in
permission and the options-page controls for it. The Sheets adapter is still in the library
(`commentlayer/sheets`) for backends that want a spreadsheet as storage, and
[docs/google-setup.md](docs/google-setup.md) covers what a fork needs to bring sheet layers
back.

## Theming

Three brand colors drive the whole overlay: **primary** (pins, switch, accents), **secondary**
(the pill and panel background), and **tertiary** (text). Everything else is derived. They
resolve in this order, first match wins:

1. Colors a reviewer set in the panel's **Theme** view, saved per site in their browser. In the
   extension, the default colors on the options page count here too, for every site.
2. Colors the host passes in: `data-primary`, `data-secondary`, `data-tertiary` on the script
   tag, or `theme: { primary, secondary, tertiary }` in `window.CommentLayerConfig`.
3. The host site's own custom properties on `:root`: `--primary-color`, `--color-primary`,
   `--primary`, `--brand-color`, `--brand`, `--accent-color`, `--color-accent`, `--accent`, and
   `--secondary-color`, `--color-secondary`, `--secondary` (the same three for tertiary). A
   value that isn't a color on its own, such as a bare HSL triplet, is skipped.
4. The defaults: magenta on near-black.

Any CSS color works, including `oklch()`, `lab()` and `color(display-p3 …)`. Text and on-accent
colors are picked for contrast automatically when not given, so a light secondary gets dark text
without any configuration. For finer control, override the derived tokens (`--cl-accent`,
`--cl-bg`, `--cl-fg`, `--cl-surface`, `--cl-font`, and so on) on `.cl-ui` in the host's
stylesheet. The three brand tokens themselves are written by the overlay at runtime, so set
those through the options above rather than CSS.

## Holidays

Around a handful of holidays the status dot in the pill turns into a small icon in the same
colors: a pumpkin for Halloween, a heart for Valentine's Day, a clover for St. Patrick's Day, a
star for the Fourth of July, a turkey for US Thanksgiving, a tree for Christmas, and a sparkle
for New Year's. Each shows for three days: the day before, the day of, and the day after. Force
one with `data-holiday="halloween"` on the script tag (or `holiday` in the config) to preview
it, or turn them off with `data-holiday="off"`.

## Developing

`npm run typecheck`, `npm test`, and `npm run build:extension` (which writes `extension/dist` and
copies the overlay and the Worker's pages into `worker/public`). Node 22 or newer. The library
is plain TypeScript consumed as source inside the repo; `npm run build` compiles it to `dist/`
with type declarations, which is what the npm package ships along with `client/`. Only the
extension's service worker is bundled (esbuild). `npm run package` builds the extension and
zips it for the Chrome Web Store as `commentlayer-<version>.zip`; the listing copy is in
[store/LISTING.md](store/LISTING.md). Release the npm package with `pnpm publish` from this
directory, which runs the build first and swaps in the `dist` entry points from `publishConfig`.

The tests cover the store and handler, the Sheets adapter, and the Worker's routes. The overlay
itself has no automated tests yet.

## Pieces

- `client/commentlayer.js`, `client/commentlayer.css`: the overlay. Framework-free. Re-keys on
  history navigation, so single-page apps work. Themed with `--cl-*` custom properties.
- `src/core.ts`: `createCommentStore({ persistence, adminToken })`, `createHandler(getStore,
  { base, cors })`, `memoryPersistence()`, `sha256()`. No Node imports; runs anywhere.
- `src/index.ts`: the Node entry. Re-exports core and adds `filePersistence(dir)` and `CLIENT_DIR`.
- `src/sheets.ts`: `sheetsPersistence({ spreadsheetId, token })` and `createLayerSpreadsheet()`,
  a Google Sheets persistence adapter. Runs anywhere `fetch` does.
- `worker/`: Cloudflare Worker. Hosted layers (`/api/layers`, `/api/l/<id>/…`, one Durable Object
  per layer with a sliding TTL), the single-tenant `/api/commentlayer` backend, and the static
  pages in `worker/pages`: the invite page (`/join`) and the privacy policy (`/privacy`).
- `extension/src/`: Manifest V3 extension. `background.ts` (bundled by the build) holds the
  layers and talks to the hosted Worker or your own backend; `bridge.js` hands the overlay its
  config and a fetch that goes through the service worker; `join.js` runs on the invite page
  and adds the layer; `options.html` and `options.js` are the options page.
- `store/`, `brand/`: the Chrome Web Store listing copy, screenshots, promo images and logos.
- `test/`: `npm test` runs the core through the handler, the Sheets adapter, and the Worker's
  routes with the Node test runner.

## Host configuration

The overlay reads `window.CommentLayerConfig` if a host sets it before the script runs: an object
or a promise of one. A promise resolving to `null` means "not on this page".

| Key | What it does |
| --- | --- |
| `api` | Base URL of the backend. The script's `data-api` attribute wins over it. |
| `fetch(url, init)` | Replaces `fetch` for every request, for hosts that proxy the API. |
| `storage { get, set }` | Replaces `localStorage` for the reviewer's name, token and theme. |
| `scopeHost` | Keys pages by host and path instead of path alone, for one backend across sites. |
| `theme` | `{ primary, secondary, tertiary }`, the same as the `data-*` color attributes. |
| `hosts` | Hostname allowlist, the same as `data-hosts`: a list or a comma-separated string. |
| `holiday` | A holiday name to force its icon, or `"off"`. |

## API

Relative to the base: `GET/POST comments`, `PATCH/DELETE comments/:id`,
`POST comments/:id/vote`, `GET comments.csv`, `GET/POST versions`, `PATCH versions/:id`. Owner
identity is the `X-Comment-Token` header, hashed before storage. Admin actions need
`X-Comment-Admin`: the overlay asks for the token the first time an admin action is tried, or
picks it up from a visit to any page at `#cl-admin=<token>`. On the Worker's hosted layers every
route also needs the layer's invite key in `X-Layer-Key`.

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
