/**
 * Validation against the real published `eve` package (devDependency).
 *
 * Two layers of protection:
 * 1. Type-level: eve's ToolContext / HookContext / DynamicResolveContext must
 *    stay assignable to our EveContext. If eve changes its session shape,
 *    `pnpm check` fails here before any runtime surprise.
 * 2. Behavioral: the exact wiring the README/codegen ship (defineDynamic,
 *    defineTool, defineHook) is constructed and its handlers invoked with
 *    real-shaped contexts, including eve's documented edge cases
 *    (unprotected agents expose auth.current/initiator as null).
 */
import { describe, expect, it } from "@effect/vitest"
import { defineHook, type HookContext } from "eve/hooks"
import { defineDynamic, defineInstructions, type DynamicResolveContext } from "eve/instructions"
import { defineTool, type ToolContext } from "eve/tools"
import { z } from "zod"
import { inMemoryAdapter, stubEmbedder } from "../src/adapters.js"
import { type EveContext, resolveIdentity } from "../src/eve/context.js"
import { defineMemory, type MemoryInstance } from "../src/eve/define-memory.js"

// -- 1. Type-level compatibility (compile-time assertions) -------------------

const acceptsToolContext = (ctx: ToolContext): EveContext => ctx
const acceptsHookContext = (ctx: HookContext): EveContext => ctx
const acceptsDynamicContext = (ctx: DynamicResolveContext): EveContext => ctx
void acceptsToolContext
void acceptsHookContext
void acceptsDynamicContext

// -- 2. Behavioral validation -------------------------------------------------

/** A ctx shaped exactly like eve's DynamicResolveContext for a protected agent. */
const protectedCtx = (
  principalId: string,
  sessionId: string,
  messages: DynamicResolveContext["messages"] = []
): DynamicResolveContext => ({
  session: {
    id: sessionId,
    auth: {
      initiator: {
        attributes: {},
        authenticator: "app",
        principalId,
        principalType: "user"
      },
      current: null
    }
  },
  channel: { kind: "http" },
  messages
})

/** Unprotected agents expose both auth fields as null (eve docs). */
const unprotectedCtx = (sessionId: string): DynamicResolveContext => ({
  session: {
    id: sessionId,
    auth: { initiator: null, current: null }
  },
  channel: {},
  messages: []
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
    semanticRecall: { threshold: 0.3 },
    ...config
  })
  try {
    await run(memory)
  } finally {
    await memory.dispose()
  }
}

describe("resolveIdentity against real eve shapes", () => {
  it("uses the initiator principal on protected agents", () => {
    expect(resolveIdentity(protectedCtx("user-1", "s1"))).toEqual({
      resourceId: "user-1",
      threadId: "s1",
      source: "initiator"
    })
  })

  it("falls back to the current caller when the initiator is null", () => {
    const ctx: DynamicResolveContext = {
      session: {
        id: "s1",
        auth: {
          initiator: null,
          current: { attributes: {}, authenticator: "app", principalId: "user-2", principalType: "user" }
        }
      },
      channel: {},
      messages: []
    }
    expect(resolveIdentity(ctx)).toEqual({ resourceId: "user-2", threadId: "s1", source: "current" })
  })

  it("keeps the thread id even when both auth fields are null (unprotected agent)", () => {
    expect(resolveIdentity(unprotectedCtx("s9"))).toEqual({
      resourceId: "anonymous",
      threadId: "s9",
      source: "anonymous"
    })
  })
})

describe("onUnresolvedIdentity", () => {
  it("rejects operations when set to \"error\"", () =>
    withMemory({ onUnresolvedIdentity: "error" }, async (memory) => {
      await expect(memory.save(unprotectedCtx("s1"), "fact")).rejects.toThrow(/IdentityUnresolvedError|identity/i)
    }))

  it("pools under anonymous by default", () =>
    withMemory({}, async (memory) => {
      const saved = await memory.save(unprotectedCtx("s1"), "fact")
      expect(saved.resourceId).toBe("anonymous")
    }))
})

describe("the generated wiring against real eve helpers", () => {
  it("defineDynamic injection resolver builds instructions from memory", () =>
    withMemory({ workingMemory: { template: "- name:" } }, async (memory) => {
      // Mirrors what `eve-memory init` generates at agent/instructions/memory.ts
      const dynamic = defineDynamic({
        events: {
          "turn.started": async (_event, ctx) => {
            const markdown = await memory.buildInjection(ctx)
            return defineInstructions({ markdown: markdown || "(no memory yet)" })
          }
        }
      })

      const result = await dynamic.events["turn.started"]!(
        { data: { sequence: 1, turnId: "t1" }, type: "turn.started" },
        protectedCtx("user-1", "s1")
      )
      expect(result).toMatchObject({ markdown: expect.stringContaining("## Working memory") })
    }))

  it("buildInjection recalls using the last user message from ctx.messages", () =>
    withMemory({}, async (memory) => {
      await memory.save(protectedCtx("user-1", "s1"), "the user prefers dark mode themes")

      const ctx = protectedCtx("user-1", "s2", [
        { role: "assistant", content: "How can I help?" },
        { role: "user", content: [{ type: "text", text: "which mode themes do I prefer dark" }] }
      ])
      const block = await memory.buildInjection(ctx)

      expect(block).toContain("## Relevant memories")
      expect(block).toContain("dark mode")
    }))

  it("defineTool remember saves through the memory instance", () =>
    withMemory({}, async (memory) => {
      // Mirrors agent/tools/remember.ts
      const remember = defineTool({
        description: "Save a durable fact about the user for future conversations.",
        inputSchema: z.object({ fact: z.string() }),
        async execute({ fact }, ctx) {
          await memory.save(ctx, fact)
          return { saved: true }
        }
      })

      const toolCtx = { ...protectedCtx("user-1", "s1"), turn: { id: "t1", sequence: 1 } }
      const result = await remember.execute({ fact: "prefers typescript" }, toolCtx as unknown as ToolContext)
      expect(result).toEqual({ saved: true })

      const hits = await memory.recall(protectedCtx("user-1", "s2"), "prefers typescript")
      expect(hits.length).toBeGreaterThan(0)
    }))

  it("defineHook passive capture saves message.received text", () =>
    withMemory({}, async (memory) => {
      // Mirrors agent/hooks/memory.ts
      const hook = defineHook({
        events: {
          "message.received": async (event, ctx) => {
            await memory.save(ctx, event.data.message)
          }
        }
      })

      const hookCtx = {
        session: protectedCtx("user-1", "s1").session,
        agent: { name: "test" },
        channel: {}
      }
      await hook.events!["message.received"]!(
        { data: { message: "I use Effect for everything", sequence: 1, turnId: "t1" }, type: "message.received" },
        hookCtx as unknown as HookContext
      )

      const hits = await memory.recall(protectedCtx("user-1", "s2"), "I use Effect for everything")
      expect(hits.length).toBeGreaterThan(0)
    }))
})
