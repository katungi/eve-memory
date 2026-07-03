/** eve-memory — public API */

export { EmbeddingError, IdentityUnresolvedError, MemoryStorageError } from "./errors.js"
export { Embedder, type EmbedderService, Memory, type MemoryService } from "./service.js"
export type {
  MemoryEntry,
  MemoryId,
  MemorySearchResult,
  Scope,
  SearchMemoryInput,
  StoreMemoryInput,
  Vector,
  WorkingMemoryKey
} from "./types.js"
export {
  defineMemory,
  type DefineMemoryConfig,
  type MemoryInstance,
  type SemanticRecallConfig,
  type WorkingMemoryConfig
} from "./eve/define-memory.js"
export type { EveContext, IdentitySource, ResolvedIdentity } from "./eve/context.js"
