# eve-memory-pg

Postgres/pgvector storage adapter for [`eve-memory`](https://www.npmjs.com/package/eve-memory) — durable cross-session memory for [Vercel eve](https://vercel.com/eve) agents.

```bash
pnpm add eve-memory eve-memory-pg pg
```

Your database needs the [pgvector](https://github.com/pgvector/pgvector) extension available (Neon, Supabase, RDS, and Vercel-integrated Postgres all ship it). The adapter runs an idempotent migration at startup.

## Usage

```ts
import { defineMemory } from "eve-memory";
import { gatewayEmbedder } from "eve-memory/adapters";
import { pgMemoryAdapter } from "eve-memory-pg";

export default defineMemory({
  adapter: pgMemoryAdapter({
    connectionString: process.env.DATABASE_URL!,
    dimensions: 1536, // must match your embedding model
  }),
  embedder: gatewayEmbedder({ model: "openai/text-embedding-3-small" }),
  semanticRecall: { topK: 5, scope: "resource" },
  workingMemory: { template: "- name:\n- preferences:" },
});
```

### Bring your own client

Anything with a `query(sql, params) => Promise<{ rows }>` works — a `pg.Pool`, Neon's serverless driver, or PGlite in tests:

```ts
pgMemoryAdapter({ client: myPool, dimensions: 1536 });
```

With `connectionString`, the adapter creates a `pg.Pool` and closes it on `memory.dispose()`. With `client`, you own the lifecycle.

### Options

| Option | Required | Description |
|---|---|---|
| `dimensions` | ✅ | Embedding dimension of the `vector` column (e.g. 1536 for `openai/text-embedding-3-small`, 128 for `stubEmbedder`) |
| `client` or `connectionString` | ✅ one of | How to reach Postgres |
| `tablePrefix` | | Table name prefix, default `eve_memory` |

## Tables

`<prefix>_entries` (id, resource_id, thread_id, content, `vector` embedding, seq, created_at) and `<prefix>_working` (scope, resource_id, thread_id, content, updated_at). Search uses pgvector cosine distance (`<=>`).

## License

MIT
