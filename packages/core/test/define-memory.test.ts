import { describe, expect, it } from "@effect/vitest"
import { inMemoryAdapter, stubEmbedder } from "../src/adapters.js"
import { defineMemory, type MemoryInstance } from "../src/eve/define-memory.js"

/** Minimal structural stand-in for an eve tool/hook context. */
const eveCtx = (principalId?: string, sessionId?: string) => ({
  session: {
    id: sessionId,
    auth: { initiator: principalId === undefined ? null : { principalId }, current: null }
  }
})

/**
 * This repo runs vitest with `sequence.concurrent`, so instances are scoped
 * per test (a shared afterEach would dispose runtimes out from under
 * concurrently running tests). In-memory runtimes hold no OS resources.
 */
const withMemory = async (
  config: Partial<Parameters<typeof defineMemory>[0]>,
  run: (memory: MemoryInstance) => Promise<void>
) => {
  const memory = defineMemory({
    adapter: inMemoryAdapter(),
    embedder: stubEmbedder(),
    ...config
  })
  try {
    await run(memory)
  } finally {
    await memory.dispose()
  }
}

describe("defineMemory", () => {
  it("saves and recalls across sessions for the same resource", () =>
    withMemory({ semanticRecall: { threshold: 0.3 } }, async (memory) => {
      await memory.save(eveCtx("user-1", "session-a"), "the user prefers TypeScript and Effect")
      const hits = await memory.recall(eveCtx("user-1", "session-b"), "what does the user prefer TypeScript")

      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].entry.content).toContain("TypeScript")
    }))

  it("does not recall another user's memories", () =>
    withMemory({ semanticRecall: { threshold: 0.3 } }, async (memory) => {
      await memory.save(eveCtx("user-1"), "user one secret preference")
      const hits = await memory.recall(eveCtx("user-2"), "user one secret preference")

      expect(hits).toHaveLength(0)
    }))

  it("resolves anonymous identity when auth is missing", () =>
    withMemory({ semanticRecall: { threshold: 0.3 } }, async (memory) => {
      const saved = await memory.save({}, "anonymous fact")
      expect(saved.resourceId).toBe("anonymous")
      expect(saved.threadId).toBe("default")
    }))

  it("honours a custom resource resolver", () =>
    withMemory({ resource: () => "custom-id" }, async (memory) => {
      const saved = await memory.save(eveCtx("ignored"), "fact")
      expect(saved.resourceId).toBe("custom-id")
      expect(memory.resolveIdentity(eveCtx("ignored")).source).toBe("resolver")
    }))

  it("round-trips working memory, serialising objects to JSON", () =>
    withMemory({}, async (memory) => {
      await memory.setWorkingMemory(eveCtx("user-1", "session-a"), { name: "Daniel", stack: ["Effect"] })
      const stored = await memory.getWorkingMemory(eveCtx("user-1", "session-b"))

      expect(stored).not.toBeNull()
      expect(JSON.parse(stored as string)).toEqual({ name: "Daniel", stack: ["Effect"] })
    }))

  it("buildInjection combines the template and recalled memories", () =>
    withMemory({
      semanticRecall: { threshold: 0.3 },
      workingMemory: { template: "- name:\n- preferences:" }
    }, async (memory) => {
      const ctx = eveCtx("user-1", "session-a")

      await memory.save(ctx, "the user prefers dark mode")
      const block = await memory.buildInjection(ctx, "which mode does the user prefer dark")

      expect(block).toContain("# Memory")
      expect(block).toContain("## Working memory")
      expect(block).toContain("- name:")
      expect(block).toContain("## Relevant memories")
      expect(block).toContain("dark mode")
    }))

  it("prefers stored working memory over the template in buildInjection", () =>
    withMemory({ workingMemory: { template: "- name:" } }, async (memory) => {
      const ctx = eveCtx("user-1")

      await memory.setWorkingMemory(ctx, "- name: Daniel")
      const block = await memory.buildInjection(ctx)

      expect(block).toContain("- name: Daniel")
      expect(block).not.toContain("## Relevant memories")
    }))

  it("returns an empty string when everything is disabled", () =>
    withMemory({ semanticRecall: false, workingMemory: false }, async (memory) => {
      const block = await memory.buildInjection(eveCtx("user-1"), "anything")
      expect(block).toBe("")
      expect(await memory.recall(eveCtx("user-1"), "anything")).toHaveLength(0)
      expect(await memory.getWorkingMemory(eveCtx("user-1"))).toBeNull()
    }))

  it("keeps stores isolated between defineMemory instances", () =>
    withMemory({ semanticRecall: { threshold: 0.1 } }, (first) =>
      withMemory({ semanticRecall: { threshold: 0.1 } }, async (second) => {
        await first.save(eveCtx("user-1"), "only in the first store")
        const hits = await second.recall(eveCtx("user-1"), "only in the first store")

        expect(hits).toHaveLength(0)
      })))

  it("rejects operations after dispose", async () => {
    const memory = defineMemory({ adapter: inMemoryAdapter(), embedder: stubEmbedder() })
    await memory.dispose()
    await expect(memory.save(eveCtx("user-1"), "too late")).rejects.toThrow()
  })
})
