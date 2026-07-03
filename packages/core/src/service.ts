/** service — Memory and Embedder Context.Tag service tags */

import { Context, type Effect, type Option } from "effect"
import type { EmbeddingError, MemoryStorageError } from "./errors.js"
import type {
  MemoryEntry,
  MemoryId,
  MemorySearchResult,
  SearchMemoryInput,
  StoreMemoryInput,
  Vector,
  WorkingMemoryKey
} from "./types.js"

/**
 * Storage adapter contract. Adapters deal in vectors only — embedding text
 * is the Embedder's job, and the orchestration layer wires the two together.
 */
export interface MemoryService {
  readonly store: (input: StoreMemoryInput) => Effect.Effect<MemoryEntry, MemoryStorageError>
  readonly search: (
    input: SearchMemoryInput
  ) => Effect.Effect<ReadonlyArray<MemorySearchResult>, MemoryStorageError>
  /** Idempotent: removing an unknown id succeeds. */
  readonly remove: (id: MemoryId) => Effect.Effect<void, MemoryStorageError>
  readonly getWorkingMemory: (
    key: WorkingMemoryKey
  ) => Effect.Effect<Option.Option<string>, MemoryStorageError>
  readonly setWorkingMemory: (
    key: WorkingMemoryKey,
    content: string
  ) => Effect.Effect<void, MemoryStorageError>
}

export interface EmbedderService {
  readonly embed: (text: string) => Effect.Effect<Vector, EmbeddingError>
}

export class Memory extends Context.Tag("eve-memory/Memory")<Memory, MemoryService>() {}

export class Embedder extends Context.Tag("eve-memory/Embedder")<Embedder, EmbedderService>() {}
