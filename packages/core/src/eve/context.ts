/** context — EveMemoryContext shape for defineMemory */

import type { MemoryEntry } from "../types.js"

export interface EveMemoryContext {
  readonly sessionId: string
  readonly entries: ReadonlyArray<MemoryEntry>
}

export const emptyEveMemoryContext = (sessionId: string): EveMemoryContext => ({
  sessionId,
  entries: []
})
