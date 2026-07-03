/** cli/init — `eve-memory init` scaffolding generator (zero deps beyond effect) */

import { Effect } from "effect"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface InitOptions {
  /** Agent directory to generate into (eve convention: "agent"). */
  readonly dir: string
  readonly embedder: "gateway" | "stub"
  /** Gateway embedding model id, when embedder is "gateway". */
  readonly model: string
  /** Overwrite existing files. */
  readonly force: boolean
}

const memoryTs = (options: InitOptions) => {
  const embedder = options.embedder === "gateway"
    ? `gatewayEmbedder({ model: "${options.model}" })`
    : "stubEmbedder()"
  const embedderImport = options.embedder === "gateway" ? "gatewayEmbedder" : "stubEmbedder"
  return `import { defineMemory } from "eve-memory";
import { ${embedderImport}, inMemoryAdapter } from "eve-memory/adapters";

export default defineMemory({
  // Swap for a persistent adapter before production — in-memory state
  // does not survive process restarts or serverless cold starts.
  // See eve-memory-pg for the Postgres/pgvector adapter.
  adapter: inMemoryAdapter(),
  embedder: ${embedder},
  semanticRecall: { topK: 5, scope: "resource" },
  workingMemory: { template: "- name:\\n- preferences:\\n- goals:" },
});
`
}

/**
 * Injection at turn start. \`buildInjection\` recalls using the last user
 * message from ctx.messages automatically; working memory rides along.
 */
const instructionsTs = `import { defineDynamic, defineInstructions } from "eve/instructions";
import memory from "../memory";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const markdown = await memory.buildInjection(ctx);
      return defineInstructions({ markdown: markdown || "(no memory yet)" });
    },
  },
});
`

const rememberTs = `import { defineTool } from "eve/tools";
import { z } from "zod";
import memory from "../memory";

export default defineTool({
  description: "Save a durable fact about the user for future conversations.",
  inputSchema: z.object({ fact: z.string() }),
  async execute({ fact }, ctx) {
    await memory.save(ctx, fact);
    return { saved: true };
  },
});
`

const hooksTs = `import { defineHook } from "eve/hooks";
import memory from "../memory";

export default defineHook({
  events: {
    "message.received": async (event, ctx) => {
      await memory.save(ctx, event.data.message);
    },
  },
});
`

const templates = (options: InitOptions): ReadonlyArray<{ path: string; content: string }> => [
  { path: "memory.ts", content: memoryTs(options) },
  { path: "instructions/memory.ts", content: instructionsTs },
  { path: "tools/remember.ts", content: rememberTs },
  { path: "hooks/memory.ts", content: hooksTs }
]

const fileExists = (target: string) =>
  Effect.promise(() => fs.access(target).then(() => true, () => false))

/** Filesystem failures are defects here: this only runs from the one-shot bin. */
export const runInit = (options: InitOptions): Effect.Effect<void> =>
  Effect.gen(function*() {
    for (const file of templates(options)) {
      const target = path.join(options.dir, file.path)
      if (!options.force && (yield* fileExists(target))) {
        yield* Effect.log(`skipped ${target} (already exists)`)
        continue
      }
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, file.content, "utf8")
      })
      yield* Effect.log(`wrote ${target}`)
    }
    yield* Effect.log("eve-memory wiring complete — edit memory.ts to configure adapters and identity.")
  })
