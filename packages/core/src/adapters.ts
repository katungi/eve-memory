/** adapters — package subpath entry (./adapters) */

export { gatewayEmbedder, type GatewayEmbedderOptions } from "./adapters/gateway.js"
export { inMemoryAdapter, stubEmbedder } from "./adapters/in-memory.js"
export { Embedder, type EmbedderService, Memory, type MemoryService } from "./service.js"
