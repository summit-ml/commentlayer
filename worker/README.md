# CommentLayer on Cloudflare Workers

The backend as a Worker with KV storage. Summit ML runs one for the browser extension's hosted
layers; anyone can deploy their own, and it runs on the free tier.

```sh
cd worker
npx wrangler kv namespace create COMMENTS      # copy the id into wrangler.toml
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

One KV value per layer, written with a sliding TTL (`LAYER_TTL_DAYS`, default 30): a layer is
deleted that many days after its last note. Reviewers export CSV or JSON from the overlay any
time. Keys are stored hashed.

## Single-tenant backend (for the embed)

`/api/commentlayer/*` is the same API without layers, keeping everything in one KV key, with
`ADMIN_TOKEN` as the admin secret. The Worker also serves the overlay files at
`/commentlayer.js` and `/commentlayer.css` (copied in by `npm run build` at the package root):

```html
<link rel="stylesheet" href="https://commentlayer.<you>.workers.dev/commentlayer.css">
<script src="https://commentlayer.<you>.workers.dev/commentlayer.js" data-api="https://commentlayer.<you>.workers.dev/api/commentlayer" defer></script>
```

Or paste `https://commentlayer.<you>.workers.dev/api/commentlayer` into the extension under
"Advanced".

Writes are last-writer-wins per layer, which is fine for a review team and wrong for thousands
of concurrent users; D1 is the upgrade path.
