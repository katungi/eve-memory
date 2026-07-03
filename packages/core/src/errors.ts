/** errors — tagged errors for the memory and embedder services */

import { Schema } from "effect"

export class MemoryStorageError extends Schema.TaggedError<MemoryStorageError>()(
  "MemoryStorageError",
  {
    operation: Schema.Literal("store", "search", "remove", "getWorkingMemory", "setWorkingMemory"),
    cause: Schema.Defect
  }
) {
  override get message(): string {
    return `Memory storage failed during ${this.operation}`
  }
}

export class EmbeddingError extends Schema.TaggedError<EmbeddingError>()(
  "EmbeddingError",
  {
    cause: Schema.Defect
  }
) {
  override get message(): string {
    return "Failed to embed text"
  }
}
