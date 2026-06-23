/** boundary — Effect → Promise boundary shim */

import type { Effect } from "effect"

export type RunPromise = <A>(effect: Effect.Effect<A>) => Promise<A>
