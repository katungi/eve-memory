import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { type InitOptions, runInit } from "../src/cli/init.js"

const defaults: Omit<InitOptions, "dir"> = {
  embedder: "gateway",
  model: "openai/text-embedding-3-small",
  force: false
}

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eve-memory-init-"))
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const read = (dir: string, file: string) => fs.readFile(path.join(dir, file), "utf8")

describe("eve-memory init", () => {
  it("generates the four wiring files", () =>
    withTempDir(async (dir) => {
      await Effect.runPromise(runInit({ ...defaults, dir }))

      const memory = await read(dir, "memory.ts")
      expect(memory).toContain("defineMemory")
      expect(memory).toContain("gatewayEmbedder({ model: \"openai/text-embedding-3-small\" })")

      const instructions = await read(dir, "instructions/memory.ts")
      expect(instructions).toContain("defineDynamic")
      expect(instructions).toContain("turn.started")
      expect(instructions).toContain("buildInjection")

      const tool = await read(dir, "tools/remember.ts")
      expect(tool).toContain("defineTool")
      expect(tool).toContain("memory.save")

      const hook = await read(dir, "hooks/memory.ts")
      expect(hook).toContain("defineHook")
      expect(hook).toContain("message.received")
    }))

  it("uses the stub embedder when asked", () =>
    withTempDir(async (dir) => {
      await Effect.runPromise(runInit({ ...defaults, dir, embedder: "stub" }))

      const memory = await read(dir, "memory.ts")
      expect(memory).toContain("stubEmbedder()")
      expect(memory).not.toContain("gatewayEmbedder")
    }))

  it("never overwrites existing files without --force", () =>
    withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "memory.ts"), "// hand-written config")
      await Effect.runPromise(runInit({ ...defaults, dir }))

      expect(await read(dir, "memory.ts")).toBe("// hand-written config")
      // the other files are still generated
      expect(await read(dir, "tools/remember.ts")).toContain("defineTool")
    }))

  it("overwrites with force", () =>
    withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "memory.ts"), "// stale")
      await Effect.runPromise(runInit({ ...defaults, dir, force: true }))

      expect(await read(dir, "memory.ts")).toContain("defineMemory")
    }))
})
