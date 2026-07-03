import { describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { inMemoryAdapter, stubEmbedder } from "../src/adapters.js"
import { Embedder, Memory } from "../src/service.js"
import type { SearchMemoryInput } from "../src/types.js"

const layer = () => Effect.provide(inMemoryAdapter())

const searchDefaults = {
  scope: "resource",
  topK: 5,
  threshold: 0,
  messageRange: 0
} as const satisfies Partial<SearchMemoryInput>

describe("inMemoryAdapter", () => {
  it.effect("stores and finds entries by vector similarity", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "likes typescript", embedding: [1, 0, 0] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "owns a dog", embedding: [0, 1, 0] })

      const results = yield* memory.search({
        ...searchDefaults,
        embedding: [0.9, 0.1, 0],
        resourceId: "u1",
        threadId: "t1",
        threshold: 0.5
      })

      ctx.expect(results).toHaveLength(1)
      ctx.expect(results[0].entry.content).toBe("likes typescript")
      ctx.expect(results[0].score).toBeGreaterThan(0.5)
    }).pipe(layer()))

  it.effect("scopes search to resource across threads, and to thread when asked", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "from thread 1", embedding: [1, 0] })
      yield* memory.store({ resourceId: "u1", threadId: "t2", content: "from thread 2", embedding: [1, 0] })
      yield* memory.store({ resourceId: "u2", threadId: "t3", content: "another user", embedding: [1, 0] })

      const base = { ...searchDefaults, embedding: [1, 0] as const, resourceId: "u1", threadId: "t1" }

      const acrossSessions = yield* memory.search(base)
      ctx.expect(acrossSessions.map((r) => r.entry.content).sort()).toEqual(["from thread 1", "from thread 2"])

      const thisSessionOnly = yield* memory.search({ ...base, scope: "thread" })
      ctx.expect(thisSessionOnly.map((r) => r.entry.content)).toEqual(["from thread 1"])
    }).pipe(layer()))

  it.effect("orders by score and honours topK", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "weak", embedding: [1, 1] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "strong", embedding: [1, 0] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "medium", embedding: [1, 0.5] })

      const results = yield* memory.search({
        ...searchDefaults,
        embedding: [1, 0],
        resourceId: "u1",
        threadId: "t1",
        topK: 2
      })

      ctx.expect(results.map((r) => r.entry.content)).toEqual(["strong", "medium"])
    }).pipe(layer()))

  it.effect("includes messageRange neighbours from the same thread in insertion order", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "before", embedding: [0, 1] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "match", embedding: [1, 0] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "after", embedding: [0, 1] })
      yield* memory.store({ resourceId: "u1", threadId: "t1", content: "too far", embedding: [0, 1] })

      const results = yield* memory.search({
        ...searchDefaults,
        embedding: [1, 0],
        resourceId: "u1",
        threadId: "t1",
        threshold: 0.9,
        messageRange: 1
      })

      ctx.expect(results).toHaveLength(1)
      ctx.expect(results[0].neighbors.map((entry) => entry.content)).toEqual(["before", "after"])
    }).pipe(layer()))

  it.effect("remove is idempotent and removes from search", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory
      const entry = yield* memory.store({ resourceId: "u1", threadId: "t1", content: "gone", embedding: [1, 0] })
      yield* memory.remove(entry.id)
      yield* memory.remove(entry.id)
      yield* memory.remove("never-existed")

      const results = yield* memory.search({
        ...searchDefaults,
        embedding: [1, 0],
        resourceId: "u1",
        threadId: "t1"
      })
      ctx.expect(results).toHaveLength(0)
    }).pipe(layer()))

  it.effect("working memory: resource scope is shared across threads, thread scope is not", (ctx) =>
    Effect.gen(function*() {
      const memory = yield* Memory

      yield* memory.setWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "resource" }, "- name: Dan")
      const fromOtherThread = yield* memory.getWorkingMemory({ resourceId: "u1", threadId: "t2", scope: "resource" })
      ctx.expect(Option.getOrNull(fromOtherThread)).toBe("- name: Dan")

      yield* memory.setWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "thread" }, "thread-local")
      const otherThread = yield* memory.getWorkingMemory({ resourceId: "u1", threadId: "t2", scope: "thread" })
      ctx.expect(Option.isNone(otherThread)).toBe(true)
    }).pipe(layer()))
})

describe("stubEmbedder", () => {
  it.effect("is deterministic and reflects token overlap", (ctx) =>
    Effect.gen(function*() {
      const embedder = yield* Embedder
      const a = yield* embedder.embed("User likes TypeScript")
      const b = yield* embedder.embed("user likes typescript")
      const c = yield* embedder.embed("completely unrelated words here")

      ctx.expect(a).toEqual(b)
      ctx.expect(a).not.toEqual(c)
      ctx.expect(a.some((value) => value !== 0)).toBe(true)
    }).pipe(Effect.provide(stubEmbedder())))
})
