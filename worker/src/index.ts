import { createCommentStore, createHandler, type Persistence } from "../../src/core";

type Env = { COMMENTS: KVNamespace; ADMIN_TOKEN?: string };

const KEY = "data";

const kvPersistence = (kv: KVNamespace): Persistence => ({
  load: () => kv.get(KEY, "json"),
  save: (data) => kv.put(KEY, JSON.stringify(data)),
});

export default {
  fetch(req: Request, env: Env) {
    const handle = createHandler(() => createCommentStore({ persistence: kvPersistence(env.COMMENTS), adminToken: env.ADMIN_TOKEN }), { base: "/api/commentlayer", cors: true });
    return handle(req);
  },
};
