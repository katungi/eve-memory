import { afterEach, describe, expect, it } from "@effect/vitest"
import { inMemoryAdapter, stubEmbedder } from "../src/adapters.js"
import { defineMemory, type MemoryInstance } from "../src/eve/define-memory.js"

/** Minimal structural stand-in for an eve tool/hook context. */
const eveCtx = (principalId?: string, sessionId?: string) => ({
  session: {
    id: sessionId,
    auth: { initiator: principalId === undefined ? undefined : { principalId } }
  }
})

const instances: Array<MemoryInstance> = []

const make = (config?: Partial<Parameters<typeof defineMemory>[0]>) => {
  const memory = defineMemory({
    adapter: inMemoryAdapter(),
    embedder: stubEmbedder(),
    ...config
  })
  instances.push(memory)
  return memory
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((memory) => memory.dispose()))
})

describe("defineMemory", () => {
  it("saves and recalls across sessions for the same resource", async () => {
    const memory = make({ semanticRecall: { threshold: 0.3 } })

    await memory.save(eveCtx("user-1", "session-a"), "the user prefers TypeScript and Effect")
    const hits = await memory.recall(eveCtx("user-1", "session-b"), "what does the user prefer TypeScript")

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].entry.content).toContain("TypeScript")
  })

  it("does not recall another user's memories", async () => {
    const memory = make({ semanticRecall: { threshold: 0.3 } })

    await memory.save(eveCtx("user-1"), "user one secret preference")
    const hits = await memory.recall(eveCtx("user-2"), "user one secret preference")

    expect(hits).toHaveLength(0)
  })

  it("resolves anonymous identity when auth is missing", async () => {
    const memory = make({ semanticRecall: { threshold: 0.3 } })

    const saved = await memory.save({}, "anonymous fact")
    expect(saved.resourceId).toBe("anonymous")
    expect(saved.threadId).toBe("default")
  })

  it("honours a custom resource resolver", async () => {
    const memory = make({ resource: () => "custom-id" })

    const saved = await memory.save(eveCtx("ignored"), "fact")
    expect(saved.resourceId).toBe("custom-id")
  })

  it("round-trips working memory, serialising objects to JSON", async () => {
    const memory = make()
    const ctx = eveCtx("user-1", "session-a")

    await memory.setWorkingMemory(ctx, { name: "Daniel", stack: ["Effect"] })
    const stored = await memory.getWorkingMemory(eveCtx("user-1", "session-b"))

    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string)).toEqual({ name: "Daniel", stack: ["Effect"] })
  })

  it("buildInjection combines the template and recalled memories", async () => {
    const memory = make({
      semanticRecall: { threshold: 0.3 },
      workingMemory: { template: "- name:\n- preferences:" }
    })
    const ctx = eveCtx("user-1", "session-a")

    await memory.save(ctx, "the user prefers dark mode")
    const block = await memory.buildInjection(ctx, "which mode does the user prefer dark")

    expect(block).toContain("# Memory")
    expect(block).toContain("## Working memory")
    expect(block).toContain("- name:")
    expect(block).toContain("## Relevant memories")
    expect(block).toContain("dark mode")
  })

  it("prefers stored working memory over the template in buildInjection", async () => {
    const memory = make({ workingMemory: { template: "- name:" } })
    const ctx = eveCtx("user-1")

    await memory.setWorkingMemory(ctx, "- name: Daniel")
    const block = await memory.buildInjection(ctx)

    expect(block).toContain("- name: Daniel")
    expect(block).not.toContain("## Relevant memories")
  })

  it("returns an empty string when everything is disabled", async () => {
    const memory = make({ semanticRecall: false, workingMemory: false })

    const block = await memory.buildInjection(eveCtx("user-1"), "anything")
    expect(block).toBe("")
    expect(await memory.recall(eveCtx("user-1"), "anything")).toHaveLength(0)
    expect(await memory.getWorkingMemory(eveCtx("user-1"))).toBeNull()
  })

  it("keeps stores isolated between defineMemory instances", async () => {
    const first = make({ semanticRecall: { threshold: 0.1 } })
    const second = make({ semanticRecall: { threshold: 0.1 } })

    await first.save(eveCtx("user-1"), "only in the first store")
    const hits = await second.recall(eveCtx("user-1"), "only in the first store")

    expect(hits).toHaveLength(0)
  })
})
