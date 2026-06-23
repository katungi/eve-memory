/** service — Memory and Embedder Context.Tag service tags */

import { Context } from "effect"
import type { MemoryEntry, StoreMemoryInput } from "./types.js"

export interface MemoryService {
  readonly store: (input: StoreMemoryInput) => unknown
  readonly search: (query: string, limit?: number) => unknown
  readonly remove: (id: MemoryEntry["id"]) => unknown
}

export interface EmbedderService {
  readonly embed: (text: string) => unknown
}

export class Memory extends Context.Tag("eve-memory/Memory")<Memory, MemoryService>() {}

export class Embedder extends Context.Tag("eve-memory/Embedder")<Embedder, EmbedderService>() {}
