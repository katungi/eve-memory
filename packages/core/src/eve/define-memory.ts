/** define-memory — Promise-only eve-facing defineMemory */

import { Effect, Layer, ManagedRuntime, Option } from "effect"
import type { EmbeddingError, MemoryStorageError } from "../errors.js"
import { Embedder, Memory } from "../service.js"
import type { MemoryEntry, MemorySearchResult, Scope } from "../types.js"
import { type EveContext, resolveIdentity } from "./context.js"

export interface SemanticRecallConfig {
  /** Matches to retrieve (default 5). */
  readonly topK?: number
  /** Neighbouring entries around each match (default 0). */
  readonly messageRange?: number
  /** Cross-session vs per-session recall (default "resource"). */
  readonly scope?: Scope
  /** Minimum similarity 0..1 (default 0.7). */
  readonly threshold?: number
}

export interface WorkingMemoryConfig {
  /** Markdown scaffold shown to the model when no working memory exists yet. */
  readonly template?: string
  readonly scope?: Scope
}

export interface DefineMemoryConfig {
  readonly adapter: Layer.Layer<Memory>
  readonly embedder: Layer.Layer<Embedder>
  /** Cross-session identity resolver. Defaults to the session initiator's principalId. */
  readonly resource?: (ctx: EveContext) => string
  readonly semanticRecall?: SemanticRecallConfig | false
  readonly workingMemory?: WorkingMemoryConfig | false
}

export interface MemoryInstance {
  /** Persist a fact for later semantic recall. */
  readonly save: (ctx: EveContext, content: string) => Promise<MemoryEntry>
  /** Search past memories by meaning. Returns [] when semantic recall is disabled. */
  readonly recall: (ctx: EveContext, query: string) => Promise<ReadonlyArray<MemorySearchResult>>
  /** Current working memory markdown, or null when unset/disabled. */
  readonly getWorkingMemory: (ctx: EveContext) => Promise<string | null>
  /** Replace working memory. Non-string values are stored as pretty-printed JSON. No-op when disabled. */
  readonly setWorkingMemory: (ctx: EveContext, value: string | Record<string, unknown>) => Promise<void>
  /** The system-message markdown block: working memory + recalled context. */
  readonly buildInjection: (ctx: EveContext, query?: string) => Promise<string>
  /** Release the underlying runtime. Only needed in tests or hot-reload setups. */
  readonly dispose: () => Promise<void>
}

const RECALL_DEFAULTS = { topK: 5, messageRange: 0, scope: "resource", threshold: 0.7 } as const

type MemoryEffect<A> = Effect.Effect<A, EmbeddingError | MemoryStorageError, Memory | Embedder>

export const defineMemory = (config: DefineMemoryConfig): MemoryInstance => {
  const runtime = ManagedRuntime.make(Layer.merge(config.adapter, config.embedder))

  const identity = (ctx: EveContext) => resolveIdentity(ctx, config.resource)

  const recallConfig = config.semanticRecall === false
    ? false
    : { ...RECALL_DEFAULTS, ...config.semanticRecall }
  const workingMemoryConfig = config.workingMemory === false
    ? false
    : { scope: "resource" as Scope, ...config.workingMemory }
  const template = workingMemoryConfig === false ? undefined : workingMemoryConfig.template

  const save = (ctx: EveContext, content: string): MemoryEffect<MemoryEntry> =>
    Effect.gen(function*() {
      const embedder = yield* Embedder
      const memory = yield* Memory
      const embedding = yield* embedder.embed(content)
      return yield* memory.store({ ...identity(ctx), content, embedding })
    })

  const recall: (ctx: EveContext, query: string) => MemoryEffect<ReadonlyArray<MemorySearchResult>> =
    recallConfig === false
      ? () => Effect.succeed([])
      : (ctx, query) =>
        Effect.gen(function*() {
          const embedder = yield* Embedder
          const memory = yield* Memory
          const embedding = yield* embedder.embed(query)
          return yield* memory.search({ embedding, ...identity(ctx), ...recallConfig })
        })

  const getWorkingMemory: (ctx: EveContext) => MemoryEffect<string | null> = workingMemoryConfig === false
    ? () => Effect.succeed(null)
    : (ctx) =>
      Effect.gen(function*() {
        const memory = yield* Memory
        const stored = yield* memory.getWorkingMemory({ ...identity(ctx), scope: workingMemoryConfig.scope })
        return Option.getOrNull(stored)
      })

  const setWorkingMemory: (ctx: EveContext, value: string | Record<string, unknown>) => MemoryEffect<void> =
    workingMemoryConfig === false
      ? () => Effect.void
      : (ctx, value) =>
        Effect.gen(function*() {
          const memory = yield* Memory
          const content = typeof value === "string" ? value : JSON.stringify(value, null, 2)
          yield* memory.setWorkingMemory({ ...identity(ctx), scope: workingMemoryConfig.scope }, content)
        })

  const buildInjection = (ctx: EveContext, query?: string): MemoryEffect<string> =>
    Effect.gen(function*() {
      const sections: Array<string> = []

      const workingMemoryBody = (yield* getWorkingMemory(ctx)) ?? template
      if (workingMemoryBody !== undefined) {
        sections.push(`## Working memory\n\n${workingMemoryBody}`)
      }

      const hits = query === undefined ? [] : yield* recall(ctx, query)
      if (hits.length > 0) {
        const lines = hits.map((hit) => {
          const neighbors = hit.neighbors.map((entry) => `  - ${entry.content}`)
          return [`- ${hit.entry.content}`, ...neighbors].join("\n")
        })
        sections.push(`## Relevant memories\n\n${lines.join("\n")}`)
      }

      return sections.length === 0 ? "" : `# Memory\n\n${sections.join("\n\n")}`
    })

  return {
    save: (ctx, content) => runtime.runPromise(save(ctx, content)),
    recall: (ctx, query) => runtime.runPromise(recall(ctx, query)),
    getWorkingMemory: (ctx) => runtime.runPromise(getWorkingMemory(ctx)),
    setWorkingMemory: (ctx, value) => runtime.runPromise(setWorkingMemory(ctx, value)),
    buildInjection: (ctx, query) => runtime.runPromise(buildInjection(ctx, query)),
    dispose: () => runtime.dispose()
  }
}
