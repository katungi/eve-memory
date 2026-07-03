import { PGlite } from "@electric-sql/pglite"
import { vector } from "@electric-sql/pglite/vector"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { defineMemory, Memory, type SearchMemoryInput } from "eve-memory"
import { stubEmbedder } from "eve-memory/adapters"
import { pgMemoryAdapter } from "../src/index.js"

/**
 * Real Postgres semantics without a server: PGlite bundles pgvector, so
 * every test runs the adapter's actual SQL. Each test gets a fresh
 * database (the repo runs vitest with `sequence.concurrent`).
 */
const withDb = async (run: (db: PGlite) => Promise<void>) => {
  const db = new PGlite({ extensions: { vector } })
  try {
    await run(db)
  } finally {
    await db.close()
  }
}

const runWith = <A, E>(db: PGlite, effect: Effect.Effect<A, E, Memory>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(pgMemoryAdapter({ client: db, dimensions: 3 }))))

const searchDefaults = {
  scope: "resource",
  topK: 5,
  threshold: 0,
  messageRange: 0
} as const satisfies Partial<SearchMemoryInput>

describe("pgMemoryAdapter", () => {
  it("stores and finds entries by vector similarity", () =>
    withDb(async (db) => {
      const results = await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "likes typescript", embedding: [1, 0, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "owns a dog", embedding: [0, 1, 0] })
          return yield* memory.search({
            ...searchDefaults,
            embedding: [0.9, 0.1, 0],
            resourceId: "u1",
            threadId: "t1",
            threshold: 0.5
          })
        })
      )
      expect(results).toHaveLength(1)
      expect(results[0].entry.content).toBe("likes typescript")
      expect(results[0].score).toBeGreaterThan(0.5)
      expect(results[0].entry.createdAt).toBeInstanceOf(Date)
    }))

  it("scopes search to resource across threads, and to thread when asked", () =>
    withDb(async (db) => {
      await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "from thread 1", embedding: [1, 0, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t2", content: "from thread 2", embedding: [1, 0, 0] })
          yield* memory.store({ resourceId: "u2", threadId: "t3", content: "another user", embedding: [1, 0, 0] })

          const base = { ...searchDefaults, embedding: [1, 0, 0], resourceId: "u1", threadId: "t1" }

          const acrossSessions = yield* memory.search(base)
          expect(acrossSessions.map((r) => r.entry.content).sort()).toEqual(["from thread 1", "from thread 2"])

          const thisThreadOnly = yield* memory.search({ ...base, scope: "thread" })
          expect(thisThreadOnly.map((r) => r.entry.content)).toEqual(["from thread 1"])
        })
      )
    }))

  it("orders by score and honours topK", () =>
    withDb(async (db) => {
      await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "weak", embedding: [1, 1, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "strong", embedding: [1, 0, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "medium", embedding: [1, 0.5, 0] })

          const results = yield* memory.search({
            ...searchDefaults,
            embedding: [1, 0, 0],
            resourceId: "u1",
            threadId: "t1",
            topK: 2
          })
          expect(results.map((r) => r.entry.content)).toEqual(["strong", "medium"])
        })
      )
    }))

  it("includes messageRange neighbours from the same thread in insertion order", () =>
    withDb(async (db) => {
      await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "before", embedding: [0, 1, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "match", embedding: [1, 0, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "after", embedding: [0, 1, 0] })
          yield* memory.store({ resourceId: "u1", threadId: "t1", content: "too far", embedding: [0, 1, 0] })

          const results = yield* memory.search({
            ...searchDefaults,
            embedding: [1, 0, 0],
            resourceId: "u1",
            threadId: "t1",
            threshold: 0.9,
            messageRange: 1
          })
          expect(results).toHaveLength(1)
          expect(results[0].neighbors.map((entry) => entry.content)).toEqual(["before", "after"])
        })
      )
    }))

  it("remove is idempotent and removes from search", () =>
    withDb(async (db) => {
      await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory
          const entry = yield* memory.store({ resourceId: "u1", threadId: "t1", content: "gone", embedding: [1, 0, 0] })
          yield* memory.remove(entry.id)
          yield* memory.remove(entry.id)
          yield* memory.remove("never-existed")

          const results = yield* memory.search({
            ...searchDefaults,
            embedding: [1, 0, 0],
            resourceId: "u1",
            threadId: "t1"
          })
          expect(results).toHaveLength(0)
        })
      )
    }))

  it("working memory: resource scope is shared across threads, thread scope is not", () =>
    withDb(async (db) => {
      await runWith(
        db,
        Effect.gen(function*() {
          const memory = yield* Memory

          yield* memory.setWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "resource" }, "- name: Dan")
          const fromOtherThread = yield* memory.getWorkingMemory({ resourceId: "u1", threadId: "t2", scope: "resource" })
          expect(Option.getOrNull(fromOtherThread)).toBe("- name: Dan")

          yield* memory.setWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "thread" }, "thread-local")
          const otherThread = yield* memory.getWorkingMemory({ resourceId: "u1", threadId: "t2", scope: "thread" })
          expect(Option.isNone(otherThread)).toBe(true)

          yield* memory.setWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "resource" }, "- name: Daniel")
          const updated = yield* memory.getWorkingMemory({ resourceId: "u1", threadId: "t1", scope: "resource" })
          expect(Option.getOrNull(updated)).toBe("- name: Daniel")
        })
      )
    }))

  it("persists across defineMemory instances (survives restarts)", () =>
    withDb(async (db) => {
      const ctx = { session: { id: "s1", auth: { initiator: { principalId: "u1" }, current: null } } }
      const config = () => ({
        adapter: pgMemoryAdapter({ client: db, dimensions: 128 }),
        embedder: stubEmbedder(),
        semanticRecall: { threshold: 0.3 } as const
      })

      // "process 1"
      const first = defineMemory(config())
      await first.save(ctx, "the user prefers TypeScript and Effect")
      await first.setWorkingMemory(ctx, { name: "Dan" })
      await first.dispose()

      // "process 2" — fresh runtime, same database
      const second = defineMemory(config())
      const hits = await second.recall(ctx, "what does the user prefer TypeScript")
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].entry.content).toContain("TypeScript")
      expect(await second.getWorkingMemory(ctx)).toContain("Dan")
      await second.dispose()
    }))

  it("rejects an unsafe table prefix", () =>
    withDb(async (db) => {
      const program = Effect.gen(function*() {
        const memory = yield* Memory
        yield* memory.remove("x")
      }).pipe(
        Effect.provide(pgMemoryAdapter({ client: db, dimensions: 3, tablePrefix: "bad; DROP TABLE" }))
      )
      await expect(Effect.runPromise(program)).rejects.toThrow(/invalid tablePrefix/)
    }))
})
