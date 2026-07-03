/** gateway — Embedder backed by the AI SDK / Vercel AI Gateway */

import type { EmbeddingModel } from "ai"
import { Effect, Layer } from "effect"
import { EmbeddingError } from "../errors.js"
import { Embedder } from "../service.js"

export interface GatewayEmbedderOptions {
  /**
   * A gateway embedding model id (e.g. "openai/text-embedding-3-small"),
   * or any AI SDK embedding model object for direct provider calls.
   * Gateway strings authenticate via Vercel OIDC on Vercel, or
   * AI_GATEWAY_API_KEY elsewhere — same rules as eve's `model` config.
   */
  readonly model: EmbeddingModel
}

/**
 * Real embedder via the AI SDK's `embed`. The `ai` package is resolved
 * lazily so it stays an optional peer — eve projects already depend on it
 * (eve peers on `ai@^7`). A missing `ai` install is a configuration error
 * and fails fast at layer construction.
 */
export const gatewayEmbedder = (options: GatewayEmbedderOptions): Layer.Layer<Embedder> =>
  Layer.effect(
    Embedder,
    Effect.promise(() => import("ai")).pipe(
      Effect.orDie,
      Effect.map(({ embed }) => ({
        embed: (text: string) =>
          Effect.tryPromise({
            try: async () => (await embed({ model: options.model, value: text })).embedding,
            catch: (cause) => new EmbeddingError({ cause })
          }).pipe(Effect.withSpan("eve_memory.embed"))
      }))
    )
  )
