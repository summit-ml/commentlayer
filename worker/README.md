# CommentLayer on Cloudflare Workers

The backend as a Worker. Each layer is one Durable Object, so everyone on a layer reads and
writes the same copy wherever they are. Summit ML runs one for the browser extension's hosted
layers; anyone can deploy their own, and it runs on the free tier.

```sh
cd worker
npx wrangler kv namespace create COMMENTS      # copy the id into wrangler.toml (see "Storage")
npx wrangler secret put ADMIN_TOKEN            # optional: single-tenant admin for the embed
npx wrangler deploy
```

## Hosted layers

| Route | What |
| --- | --- |
| `POST /api/layers` `{ name }` | Mints a layer: `{ id, name, key, adminKey, expiresAt, ttlDays }`. The key goes in the invite link; the admin key stays with the creator. |
| `GET /api/layers/:id` | Checks an invite (`X-Layer-Key`) and returns the layer's name and expiry. |
| `DELETE /api/layers/:id` | Deletes the layer. Needs `X-Comment-Admin: <adminKey>`. |
| `/api/l/:id/comments…`, `/api/l/:id/versions…` | The normal CommentLayer API, scoped to one layer, behind `X-Layer-Key`. `X-Comment-Admin: <adminKey>` unlocks rounds and moderation. |

A layer is deleted `LAYER_TTL_DAYS` (default 30) after its last change: a note, an edit, a vote,
a resolve, or a round. Reading a layer does not count. Reviewers export CSV or JSON from the
overlay any time. Keys are stored hashed.

## Storage

Each layer is a Durable Object of the `Layer` class (bound as `LAYERS`, with the migration in
`wrangler.toml`), holding the layer's notes and rounds as one record. All requests for a layer
go through that one object, one at a time, so two people writing at the same moment both keep
their change, and a note is visible to a teammate in another region as soon as it is posted.
An alarm on the object deletes it when the layer has been quiet for `LAYER_TTL_DAYS`.

Layers were kept in Workers KV before. KV serves reads from each location's cache for up to a
minute, and a whole record was written back on every change, so a teammate in another region
could overwrite a note that had just been posted. The KV namespace is still bound: a layer
written by an earlier version is copied into its Durable Object the first time it is asked for.

A layer's record has to fit in one Durable Object value, about 2 MB, which is several thousand
notes.

## Pages

`worker/pages` holds the static pages the extension links to, copied into `public/` by
`npm run build:extension` along with the overlay:

- `/join`: the invite page. An invite link is `/join#layer=<id>&key=<key>&name=<name>`; the
  fragment never reaches the server. With the extension installed the page shows a Join
  button, and its content script (`extension/src/join.js`) adds the layer when it is clicked;
  without it the page points at `/install` and picks up when the visitor comes back.
- `/install`: redirects to `STORE_URL` in `wrangler.toml`.
- `/`: redirects to `/join?from=site`, which shows the introduction instead of an invite.
- `/privacy`: the privacy policy for the extension and hosted layers.

## Single-tenant backend (for the embed)

`/api/commentlayer/*` is the same API without layers, kept in one Durable Object, with
`ADMIN_TOKEN` as the admin secret. The Worker also serves the overlay files at
`/commentlayer.js` and `/commentlayer.css` (copied in by `npm run build:extension` at the package root):

```html
<link rel="stylesheet" href="https://commentlayer.<you>.workers.dev/commentlayer.css">
<script src="https://commentlayer.<you>.workers.dev/commentlayer.js" data-api="https://commentlayer.<you>.workers.dev/api/commentlayer" defer></script>
```

Or paste `https://commentlayer.<you>.workers.dev/api/commentlayer` into the extension under
"Advanced".

Every change rewrites the layer's whole record, which is fine for a review team and wrong for
thousands of concurrent users; D1 is the upgrade path.
