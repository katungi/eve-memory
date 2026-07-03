/** in-memory — in-memory Memory adapter and deterministic stub Embedder (v1 default) */

import { Clock, Effect, Layer, Option } from "effect"
import { cosineSimilarity } from "../internal/vector.js"
import { Embedder, Memory } from "../service.js"
import type {
  MemoryEntry,
  MemoryId,
  MemorySearchResult,
  SearchMemoryInput,
  Vector,
  WorkingMemoryKey
} from "../types.js"

interface StoredEntry {
  readonly entry: MemoryEntry
  readonly embedding: Vector
}

const workingMemoryKey = (key: WorkingMemoryKey) =>
  key.scope === "resource" ? `r\u0000${key.resourceId}` : `t\u0000${key.resourceId}\u0000${key.threadId}`

/**
 * Process-memory storage adapter. State lives for the lifetime of the
 * runtime that builds the layer; each `defineMemory` gets a fresh store.
 */
export const inMemoryAdapter = (): Layer.Layer<Memory> =>
  Layer.sync(Memory, () => {
    /** Map iteration order is insertion order — per-thread order is derived from it. */
    const entries = new Map<MemoryId, StoredEntry>()
    const workingMemory = new Map<string, string>()
    let counter = 0

    const neighborsOf = (entry: MemoryEntry, range: number): ReadonlyArray<MemoryEntry> => {
      if (range <= 0) return []
      const thread = [...entries.values()]
        .map((stored) => stored.entry)
        .filter((other) => other.resourceId === entry.resourceId && other.threadId === entry.threadId)
      const index = thread.findIndex((other) => other.id === entry.id)
      return thread
        .slice(Math.max(0, index - range), index + range + 1)
        .filter((other) => other.id !== entry.id)
    }

    return {
      store: (input) =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          const entry: MemoryEntry = {
            id: `mem_${++counter}`,
            resourceId: input.resourceId,
            threadId: input.threadId,
            content: input.content,
            createdAt: new Date(now)
          }
          entries.set(entry.id, { entry, embedding: input.embedding })
          return entry
        }),

      search: (input: SearchMemoryInput) =>
        Effect.sync(() => {
          const matches: Array<MemorySearchResult> = []
          for (const { embedding, entry } of entries.values()) {
            if (entry.resourceId !== input.resourceId) continue
            if (input.scope === "thread" && entry.threadId !== input.threadId) continue
            const score = cosineSimilarity(input.embedding, embedding)
            if (score < input.threshold) continue
            matches.push({ entry, score, neighbors: neighborsOf(entry, input.messageRange) })
          }
          return matches
            .sort((a, b) => b.score - a.score)
            .slice(0, input.topK)
        }),

      remove: (id) =>
        Effect.sync(() => {
          entries.delete(id)
        }),

      getWorkingMemory: (key) => Effect.sync(() => Option.fromNullable(workingMemory.get(workingMemoryKey(key)))),

      setWorkingMemory: (key, content) =>
        Effect.sync(() => {
          workingMemory.set(workingMemoryKey(key), content)
        })
    }
  })

const STUB_DIMENSIONS = 128

/** FNV-1a hash, for deterministic token bucketing. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Deterministic bag-of-words embedder. Not semantic — texts score by token
 * overlap only. Good enough for tests and local development; swap for a
 * real embedder in production.
 */
export const stubEmbedder = (): Layer.Layer<Embedder> =>
  Layer.succeed(Embedder, {
    embed: (text) =>
      Effect.sync(() => {
        const vector = new Array<number>(STUB_DIMENSIONS).fill(0)
        const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0)
        for (const token of tokens) {
          const hash = fnv1a(token)
          const index = hash % STUB_DIMENSIONS
          const sign = (hash & 0x80000000) === 0 ? 1 : -1
          vector[index] += sign
        }
        return vector
      })
  })
