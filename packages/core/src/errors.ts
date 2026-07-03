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

export class IdentityUnresolvedError extends Schema.TaggedError<IdentityUnresolvedError>()(
  "IdentityUnresolvedError",
  {}
) {
  override get message(): string {
    return "eve-memory could not resolve a user identity from ctx.session.auth and onUnresolvedIdentity is \"error\". "
      + "Protect the route (see eve's auth & route protection) or configure `resource` in defineMemory."
  }
}
