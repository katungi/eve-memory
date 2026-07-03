import { describe, it } from "@effect/vitest"
import { MockEmbeddingModelV4 } from "ai/test"
import { Effect } from "effect"
import { gatewayEmbedder } from "../src/adapters.js"
import { Embedder } from "../src/service.js"

const mockModel = (embedding: ReadonlyArray<number>) =>
  new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => [...embedding]),
      warnings: []
    })
  })

describe("gatewayEmbedder", () => {
  it.effect("embeds via the AI SDK model", (ctx) =>
    Effect.gen(function*() {
      const embedder = yield* Embedder
      const vector = yield* embedder.embed("hello world")
      ctx.expect(vector).toEqual([0.1, 0.2, 0.3])
    }).pipe(Effect.provide(gatewayEmbedder({ model: mockModel([0.1, 0.2, 0.3]) }))))

  it.effect("maps provider failures to EmbeddingError", (ctx) =>
    Effect.gen(function*() {
      const embedder = yield* Embedder
      const failing = new MockEmbeddingModelV4({
        doEmbed: async () => {
          throw new Error("gateway unavailable")
        }
      })
      void failing
      const result = yield* embedder.embed("hello").pipe(Effect.flip)
      ctx.expect(result._tag).toBe("EmbeddingError")
    }).pipe(
      Effect.provide(
        gatewayEmbedder({
          model: new MockEmbeddingModelV4({
            doEmbed: async () => {
              throw new Error("gateway unavailable")
            }
          })
        })
      )
    ))
})
