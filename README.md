# eve-memory

Cross-session memory for [Vercel eve](https://vercel.com/eve) agents — **working memory** + **semantic recall** with swappable storage adapters.

eve gives agents durable state *within* a session (via Vercel Workflows). It has no built-in way to remember a user *across* sessions, no semantic recall, and no working-memory schema. `eve-memory` adds that layer — and hides all of it behind a plain `async`/`await` API.

```ts
// One file. The agent now remembers people across conversations.
import { defineMemory } from "eve-memory";
import { inMemoryAdapter, stubEmbedder } from "eve-memory/adapters";

export default defineMemory({
  adapter: inMemoryAdapter(),
  embedder: stubEmbedder(),
  semanticRecall: { topK: 5, scope: "resource" },
  workingMemory: { template: "- name:\n- preferences:\n- goals:" },
});
```

> **Status:** early but functional. The in-memory adapter, AI Gateway embedder, and `eve-memory init` codegen are working and tested — including type-level validation against the published `eve` package. A Postgres/pgvector adapter is coming as a separate package. APIs may change before `1.0`.
> **Requires:** `eve >= 0.13.0`, Node `>= 24`. The gateway embedder needs `ai >= 7` (already present in every eve project).

---

## Why

| | within a session | across sessions | by meaning |
|---|---|---|---|
| **eve alone** | ✅ Workflow state | ❌ | ❌ |
| **eve + eve-memory** | ✅ | ✅ working memory | ✅ semantic recall |

If you've used Mastra's memory, the vocabulary here is intentionally familiar: `topK`, `messageRange`, `scope: "resource" | "thread"`, `workingMemory.schema`. A *thread* is one eve session; a *resource* is a stable identity (a user) resolved from `session.auth`.

## Install

```bash
pnpm add eve-memory
# or: npm i eve-memory  /  bun add eve-memory
```

Peer dependencies (`eve`, `zod`) come from your eve project.

## How it fits into eve

eve doesn't auto-discover a `memory.ts`, so you reference your config from the three files eve *does* discover. `eve-memory` gives you a helper for each.

```
agent/
├── agent.ts
├── instructions.md
├── memory.ts                  ← your config (below)
├── instructions/
│   └── memory.ts              ← automatic injection (recall + working memory)
├── tools/
│   └── remember.ts            ← let the model save facts deliberately
└── hooks/
    └── memory.ts              ← (optional) capture turns passively
```

### 1. Define memory once — `agent/memory.ts`

```ts
import { defineMemory } from "eve-memory";
import { gatewayEmbedder, inMemoryAdapter } from "eve-memory/adapters";

export default defineMemory({
  adapter: inMemoryAdapter(),       // swap for a pg adapter later — same API
  embedder: gatewayEmbedder({ model: "openai/text-embedding-3-small" }),

  // Cross-session identity is resolved from eve's auth context automatically:
  // session initiator → current caller → "anonymous" (with a logged warning).
  // Unprotected eve agents expose both auth fields as null, so either protect
  // the route, provide your own resolver, or fail loudly:
  onUnresolvedIdentity: "error",    // or omit for the "anonymous" pool

  semanticRecall: { topK: 5, messageRange: 2, scope: "resource", threshold: 0.7 },
  workingMemory: { template: "- name:\n- preferences:\n- goals:" },
});
```

`gatewayEmbedder` uses the AI SDK, so gateway model ids authenticate through Vercel OIDC on Vercel (or `AI_GATEWAY_API_KEY` elsewhere) — the same rules as eve's `model` config. Use `stubEmbedder()` for offline development and tests.

### 2. Automatic injection — `agent/instructions/memory.ts`

Runs at the start of every turn: pulls the user's working memory and the most relevant past context, and hands it to the model as a system message. Dynamic instruction resolvers see the conversation history (`ctx.messages`), so `buildInjection` uses the latest user message as the recall query automatically. (Injection must go through dynamic instructions — eve hooks are observe-only and cannot add model context.)

```ts
import { defineDynamic, defineInstructions } from "eve/instructions";
import memory from "../memory";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const markdown = await memory.buildInjection(ctx);
      return defineInstructions({ markdown: markdown || "(no memory yet)" });
    },
  },
});
```

### 3. Deliberate writes — `agent/tools/remember.ts`

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";
import memory from "../memory";

export default defineTool({
  description: "Save a durable fact about the user for future conversations.",
  inputSchema: z.object({ fact: z.string() }),
  async execute(input, ctx) {
    await memory.save(ctx, input.fact);
    return { saved: true };
  },
});
```

### 4. Passive capture — `agent/hooks/memory.ts` (optional)

`message.received` carries each normalized user message, so passive capture is one line:

```ts
import { defineHook } from "eve/hooks";
import memory from "../memory";

export default defineHook({
  events: {
    "message.received": async (event, ctx) => {
      await memory.save(ctx, event.data.message);
    },
  },
});
```

> Or generate all four files at once: `npx eve-memory-cli init` (options: `--dir`, `--embedder gateway|stub`, `--model`, `--force`). Existing files are never overwritten without `--force`.

## The imperative API

Everything is Promise-based. Use it directly inside your own tools or hooks.

```ts
await memory.save(ctx, "User prefers TypeScript and Effect");
const hits = await memory.recall(ctx, "what languages does the user like");
await memory.setWorkingMemory(ctx, { name: "Daniel", stack: ["Effect"] });
const profile = await memory.getWorkingMemory(ctx);
const block = await memory.buildInjection(ctx); // the system-message markdown
memory.resolveIdentity(ctx);                    // { resourceId, threadId, source } — debug your auth wiring
```

`ctx` is any eve tool/hook/resolver context — `eve-memory` reads `session.auth` (and `messages`, when present) from it. `resolveIdentity` reports which source produced the resource id (`"initiator" | "current" | "resolver" | "anonymous"`), which is the first thing to check when validating a live agent.

## Configuration

```ts
defineMemory({
  adapter,                        // a storage adapter (required)
  embedder,                       // an embedder (required)
  resource?: (ctx) => string,     // identity resolver; defaults to initiator → current → "anonymous"
  onUnresolvedIdentity?: "anonymous" | "error", // default "anonymous" (warns once)

  semanticRecall?: {
    topK?: number,                // matches to retrieve (default 5)
    messageRange?: number,        // neighbours around each match (default 0)
    scope?: "resource" | "thread",// cross-session vs per-session (default "resource")
    threshold?: number,           // min similarity 0..1 (default 0.7)
  } | false,                      // false to disable recall

  workingMemory?: {
    template?: string,            // markdown shown to the model to maintain
    scope?: "resource" | "thread",
  } | false,                      // false to disable working memory
});
```

## Adapters

| Adapter | Infra | Semantic recall | Working memory | Status |
|---|---|---|---|---|
| `inMemoryAdapter()` | none (process memory) | ✅ | ✅ | ✅ available |
| `pgMemoryAdapter()` | Postgres + pgvector | ✅ | ✅ | ✅ available — [`eve-memory-pg`](packages/adapter-pg) |
| `sandboxFs()` | none (eve sandbox FS) | ✅ | ✅ | planned |

```ts
import { pgMemoryAdapter } from "eve-memory-pg";

adapter: pgMemoryAdapter({
  connectionString: process.env.DATABASE_URL!,
  dimensions: 1536, // match your embedding model
}),
```

`pgMemoryAdapter` also accepts any `{ query }` client (pg `Pool`, Neon serverless, PGlite), runs an idempotent migration at startup, and searches with pgvector cosine distance.

Embedders:

| Embedder | Backing | Status |
|---|---|---|
| `gatewayEmbedder({ model })` | AI SDK → Vercel AI Gateway (or direct provider model objects) | ✅ available |
| `stubEmbedder()` | deterministic token hashing (not semantic; dev/tests) | ✅ available |

A custom adapter implements the `Memory` service. Internally adapters are Effect `Layer`s — but you only ever *pass* them, never author Effect to *use* the library. The `Memory` and `Embedder` tags are exported from `eve-memory/adapters` for advanced/custom use.

## Effect, but hidden

`eve-memory` is built on [Effect](https://effect.website) — typed errors, layered dependencies, a fiber runtime under the hood. The public API exposes none of it: you write `await`, not `Effect.gen`. Effect crosses into eve's Promise world at exactly one internal boundary. If you *want* to write a custom adapter in Effect, you can; if you never want to see it, you never will.

## Repository layout

This is a pnpm + Effect monorepo:

```
packages/
├── core/        →  `eve-memory` (services, adapters, defineMemory)
├── adapter-pg/  →  `eve-memory-pg` (Postgres/pgvector adapter)
└── cli/         →  `eve-memory-cli` (the `init` codegen)
```

```bash
pnpm install
pnpm build       # build all packages
pnpm test        # run the suite
pnpm typecheck
```

## Roadmap

- [x] Core services, in-memory adapter, Promise API, eve wiring
- [x] Validation against eve's published types (`SessionAuth`, contexts, events) + identity diagnostics
- [x] Real embedder (`gatewayEmbedder` via the AI SDK / AI Gateway)
- [x] `npx eve-memory-cli init` codegen
- [x] Postgres/pgvector adapter (`eve-memory-pg`, tested against real pgvector SQL via PGlite)
- [ ] Publish `0.1.0`
- [ ] Smoke test against a deployed eve agent

## License

MIT
