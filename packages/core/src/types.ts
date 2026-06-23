/** types — domain types and schemas (@effect/schema) */

export type MemoryId = string

export type MemoryEntry = {
  readonly id: MemoryId
  readonly content: string
}

export type MemorySearchResult = {
  readonly entry: MemoryEntry
  readonly score: number
}

export type StoreMemoryInput = {
  readonly content: string
}
