# CommentLayer on Cloudflare Workers

The backend as a Worker with KV storage. Everyone deploys their own; it runs on the free tier.

```sh
cd worker
npx wrangler kv namespace create COMMENTS      # copy the id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN            # optional: lets one browser manage everything
npx wrangler deploy
```

The Worker serves the API at `/api/commentlayer/*` with CORS enabled, and the overlay files at
`/commentlayer.js` and `/commentlayer.css` (copied in by `pnpm build` at the package root).

Embed on any site:

```html
<link rel="stylesheet" href="https://commentlayer.<you>.workers.dev/commentlayer.css">
<script src="https://commentlayer.<you>.workers.dev/commentlayer.js" data-api="https://commentlayer.<you>.workers.dev/api/commentlayer" defer></script>
```

Or paste `https://commentlayer.<you>.workers.dev/api/commentlayer` into the browser extension.

Storage is one KV key holding every comment. Writes are last-writer-wins, which is fine for a
review team and wrong for thousands of concurrent users; D1 is the upgrade path.
