/** define-memory — Promise-only eve-facing defineMemory */

import type { EveMemoryContext } from "./context.js"

export interface DefineMemoryOptions {
  readonly sessionId?: string
}

export interface MemoryDefinition {
  readonly context: EveMemoryContext
}

export const defineMemory = (_options?: DefineMemoryOptions): Promise<MemoryDefinition> =>
  Promise.resolve({ context: { sessionId: "default", entries: [] } })
