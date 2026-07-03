/** vector — vector math utilities for similarity search */

import type { Vector } from "../types.js"

/**
 * Cosine similarity between two vectors of the same dimension.
 *
 * Returns 0 when either vector has zero magnitude. Throws a `RangeError`
 * (an Effect defect) on dimension mismatch — adapters always compare
 * embeddings produced by the same embedder, so a mismatch is a bug,
 * not a recoverable condition.
 */
export const cosineSimilarity = (a: Vector, b: Vector): number => {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
