/** types — domain types for memory entries, search, and working memory */

/** Cross-session vs per-session scoping. A thread is one eve session; a resource is a stable identity (usually a user). */
export type Scope = "resource" | "thread"

export type MemoryId = string

export type Vector = ReadonlyArray<number>

export interface MemoryEntry {
  readonly id: MemoryId
  readonly resourceId: string
  readonly threadId: string
  readonly content: string
  readonly createdAt: Date
}

export interface StoreMemoryInput {
  readonly resourceId: string
  readonly threadId: string
  readonly content: string
  readonly embedding: Vector
}

export interface SearchMemoryInput {
  readonly embedding: Vector
  readonly resourceId: string
  readonly threadId: string
  readonly scope: Scope
  readonly topK: number
  /** Minimum cosine similarity (0..1) for a match. */
  readonly threshold: number
  /** How many neighbouring entries (same thread, by insertion order) to include around each match. */
  readonly messageRange: number
}

export interface MemorySearchResult {
  readonly entry: MemoryEntry
  readonly score: number
  /** Entries adjacent to the match in its thread, when `messageRange > 0`. */
  readonly neighbors: ReadonlyArray<MemoryEntry>
}

export interface WorkingMemoryKey {
  readonly resourceId: string
  readonly threadId: string
  readonly scope: Scope
}
