/** in-memory — in-memory Memory adapter and stub Embedder (v1 default) */

import { Layer } from "effect"
import { Embedder, Memory } from "../service.js"

export const InMemoryMemoryLive = Layer.succeed(Memory, {} as import("../service.js").MemoryService)

export const StubEmbedderLive = Layer.succeed(Embedder, {} as import("../service.js").EmbedderService)
