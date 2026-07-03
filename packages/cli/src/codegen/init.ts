/** codegen/init — eve-memory init scaffolding generator */

import { FileSystem, Path } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

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

export const runInit = (
  options: InitOptions
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const file of templates(options)) {
      const target = path.join(options.dir, file.path)
      if (!options.force && (yield* fs.exists(target))) {
        yield* Effect.log(`skipped ${target} (already exists)`)
        continue
      }
      yield* fs.makeDirectory(path.dirname(target), { recursive: true })
      yield* fs.writeFileString(target, file.content)
      yield* Effect.log(`wrote ${target}`)
    }
    yield* Effect.log("eve-memory wiring complete — edit memory.ts to configure adapters and identity.")
  })
