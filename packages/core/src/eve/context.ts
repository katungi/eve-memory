/** context — structural typing + safe extraction for eve tool/hook contexts */

import { Option, Schema } from "effect"

/**
 * The slice of an eve tool/hook/resolver context that eve-memory reads.
 * All fields are optional so any eve context (and plain objects in tests)
 * matches structurally.
 */
const EveContextShape = Schema.Struct({
  session: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      auth: Schema.optional(
        Schema.Struct({
          initiator: Schema.optional(
            Schema.Struct({
              principalId: Schema.optional(Schema.String)
            })
          )
        })
      )
    })
  )
})

export type EveContext = typeof EveContextShape.Type

export interface ResolvedIdentity {
  readonly resourceId: string
  readonly threadId: string
}

const decodeContext = Schema.decodeUnknownOption(EveContextShape)

/**
 * Resolve resource (cross-session identity) and thread (this session) from
 * an eve context. eve contexts arrive untyped from the host, so the shape
 * is decoded rather than trusted; anything unreadable falls back to
 * "anonymous" / "default".
 */
export const resolveIdentity = (
  ctx: EveContext,
  resource?: (ctx: EveContext) => string
): ResolvedIdentity => {
  const session = Option.getOrUndefined(decodeContext(ctx))?.session
  return {
    resourceId: resource !== undefined
      ? resource(ctx)
      : session?.auth?.initiator?.principalId ?? "anonymous",
    threadId: session?.id ?? "default"
  }
}
