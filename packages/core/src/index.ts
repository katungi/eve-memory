/** eve-memory — public API */

export type { MemoryError, EmbeddingError, ValidationError } from "./errors.js"
export { Memory, Embedder, type MemoryService, type EmbedderService } from "./service.js"
export type { MemoryId, MemoryEntry, MemorySearchResult, StoreMemoryInput } from "./types.js"
export { defineMemory, type DefineMemoryOptions, type MemoryDefinition } from "./eve/define-memory.js"
export { emptyEveMemoryContext, type EveMemoryContext } from "./eve/context.js"
