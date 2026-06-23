/** errors — MemoryError, EmbeddingError, ValidationError (Schema.TaggedError) */

export type MemoryError = { readonly _tag: "MemoryError" }
export type EmbeddingError = { readonly _tag: "EmbeddingError" }
export type ValidationError = { readonly _tag: "ValidationError" }
