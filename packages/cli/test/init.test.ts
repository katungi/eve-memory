import { describe, expect, it } from "@effect/vitest"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Effect } from "effect"
import { runInit, type InitOptions } from "../src/codegen/init.js"

const defaults: Omit<InitOptions, "dir"> = {
  embedder: "gateway",
  model: "openai/text-embedding-3-small",
  force: false
}

describe("eve-memory init", () => {
  it.scoped("generates the four wiring files", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()

      yield* runInit({ ...defaults, dir })

      const memory = yield* fs.readFileString(`${dir}/memory.ts`)
      expect(memory).toContain("defineMemory")
      expect(memory).toContain("gatewayEmbedder({ model: \"openai/text-embedding-3-small\" })")

      const instructions = yield* fs.readFileString(`${dir}/instructions/memory.ts`)
      expect(instructions).toContain("defineDynamic")
      expect(instructions).toContain("turn.started")
      expect(instructions).toContain("buildInjection")

      const tool = yield* fs.readFileString(`${dir}/tools/remember.ts`)
      expect(tool).toContain("defineTool")
      expect(tool).toContain("memory.save")

      const hook = yield* fs.readFileString(`${dir}/hooks/memory.ts`)
      expect(hook).toContain("defineHook")
      expect(hook).toContain("message.received")
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("uses the stub embedder when asked", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()

      yield* runInit({ ...defaults, dir, embedder: "stub" })

      const memory = yield* fs.readFileString(`${dir}/memory.ts`)
      expect(memory).toContain("stubEmbedder()")
      expect(memory).not.toContain("gatewayEmbedder")
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("never overwrites existing files without --force", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()

      yield* fs.writeFileString(`${dir}/memory.ts`, "// hand-written config")
      yield* runInit({ ...defaults, dir })

      expect(yield* fs.readFileString(`${dir}/memory.ts`)).toBe("// hand-written config")
      // the other files are still generated
      expect(yield* fs.exists(`${dir}/tools/remember.ts`)).toBe(true)
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("overwrites with force", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const dir = yield* fs.makeTempDirectoryScoped()

      yield* fs.writeFileString(`${dir}/memory.ts`, "// stale")
      yield* runInit({ ...defaults, dir, force: true })

      expect(yield* fs.readFileString(`${dir}/memory.ts`)).toContain("defineMemory")
    }).pipe(Effect.provide(NodeContext.layer)))
})
