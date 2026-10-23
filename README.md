# @summit/commentlayer

Drop-a-pin review comments for any site. Pulled out of the Image Authority review site so it
can be mounted anywhere, starting with the marketing site's Railway preview.

**What reviewers get.** A floating bar at the bottom of every page with a "Turn on" button.
They enter a name once (no account), then click anywhere to drop a numbered pin and leave a
note. "Comments" opens a drawer listing every note across the site with jump links and CSV and
JSON export. Anyone can resolve a note; only its author can edit or delete it, tracked by a
random token in their browser. Comments are grouped into review rounds; an admin can start or
rename rounds, and older rounds are viewable read-only.

## Pieces

- `client/commentlayer.js` and `client/commentlayer.css`: the overlay. Framework-free, one
  script tag. Works on multi-page sites and on single-page apps (it re-keys on history
  navigation). Pages are keyed by pathname.
- `src/index.ts`: `createCommentStore({ dataDir, adminToken })` keeps `comments.json` and
  `versions.json` in a directory, and `createHandler(store, base)` answers the overlay's API
  from a Fetch `Request`, so it mounts in a Next route handler, a Hono app, Express via an
  adapter, or anything else that speaks web requests.

## Mounting

```html
<link rel="stylesheet" href="/commentlayer/commentlayer.css">
<script src="/commentlayer/commentlayer.js" data-api="/api/commentlayer" defer></script>
```

```ts
import { createCommentStore, createHandler } from "@summit/commentlayer";
const store = createCommentStore({ dataDir: process.env.COMMENTLAYER_DATA_DIR ?? "./data", adminToken: process.env.COMMENTLAYER_ADMIN_TOKEN });
export const handle = createHandler(store, "/api/commentlayer");
```

Routes under the base: `GET/POST comments`, `PATCH/DELETE comments/:id`, `GET comments.csv`,
`GET/POST versions`, `PATCH versions/:id`. Admin actions need the `X-Comment-Admin` header,
which the overlay sends after a visit to any page at `#cl-admin=<token>`.

## Theming

Everything is driven by `--cl-*` custom properties on `:root` (bar, accent, surfaces, font).
Override them in the host page's stylesheet; see `apps/web/src/components/CommentLayer.tsx`
for the Summit palette.

## Where it's mounted

- `apps/web`: on when `COMMENTLAYER=on`. Assets at `/commentlayer/*`, API at
  `/api/commentlayer`. Data in `COMMENTLAYER_DATA_DIR` (a Railway volume at `/data`).

## Later

The plan is to grow this into a standalone open-source tool, including a browser extension
that can drop pins on any site. Keep the client free of host-specific code so that stays easy.
