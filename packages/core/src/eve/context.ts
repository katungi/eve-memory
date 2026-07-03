/** context — structural typing + safe extraction for eve tool/hook contexts */

import { Option, Schema } from "effect"

const PrincipalShape = Schema.Struct({
  principalId: Schema.optional(Schema.String),
  principalType: Schema.optional(Schema.String)
})

/**
 * Mirrors eve's `SessionContext.session` / `DynamicResolveContext.session`
 * projection: `auth.current` is the caller for the active turn,
 * `auth.initiator` the caller that started the session, and **both are
 * `null` on unprotected agents**.
 */
const SessionSlice = Schema.Struct({
  session: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      auth: Schema.optional(
        Schema.Struct({
          initiator: Schema.optional(Schema.NullOr(PrincipalShape)),
          current: Schema.optional(Schema.NullOr(PrincipalShape))
        })
      )
    })
  )
})

const MessagePart = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String)
})

/**
 * Mirrors eve's `DynamicResolveContext.messages` (AI SDK `ModelMessage`s,
 * oldest first). Only dynamic instruction/tool resolvers receive this;
 * tool and hook contexts don't, which is why it is a separate slice.
 */
const MessagesSlice = Schema.Struct({
  messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        role: Schema.optional(Schema.String),
        content: Schema.optional(Schema.Union(Schema.String, Schema.Array(MessagePart)))
      })
    )
  )
})

/**
 * The slice of an eve tool/hook/resolver context that eve-memory reads.
 * All fields are optional so any eve context (and plain objects in tests)
 * matches structurally; compatibility with eve's published types is
 * asserted in `test/eve-integration.test.ts`. The two slices are decoded
 * independently so an unexpected message shape can never break identity
 * resolution (or vice versa).
 */
export type EveContext = typeof SessionSlice.Type & typeof MessagesSlice.Type

/** Where the resource id came from — useful when validating a live agent. */
export type IdentitySource = "resolver" | "initiator" | "current" | "anonymous"

export interface ResolvedIdentity {
  readonly resourceId: string
  readonly threadId: string
  readonly source: IdentitySource
}

const decodeSession = Schema.decodeUnknownOption(SessionSlice)
const decodeMessages = Schema.decodeUnknownOption(MessagesSlice)

/**
 * Resolve resource (cross-session identity) and thread (this session) from
 * an eve context. eve contexts arrive untyped from the host, so the shape
 * is decoded rather than trusted. The default resource is the session
 * initiator's principal, falling back to the current caller (multi-user
 * channels), then to "anonymous".
 */
export const resolveIdentity = (
  ctx: EveContext,
  resource?: (ctx: EveContext) => string
): ResolvedIdentity => {
  const session = Option.getOrUndefined(decodeSession(ctx))?.session
  const threadId = session?.id ?? "default"
  if (resource !== undefined) {
    return { resourceId: resource(ctx), threadId, source: "resolver" }
  }
  const initiator = session?.auth?.initiator?.principalId
  if (initiator !== undefined) {
    return { resourceId: initiator, threadId, source: "initiator" }
  }
  const current = session?.auth?.current?.principalId
  if (current !== undefined) {
    return { resourceId: current, threadId, source: "current" }
  }
  return { resourceId: "anonymous", threadId, source: "anonymous" }
}

/**
 * The text of the most recent user message visible on the context, when
 * the host provides conversation history (dynamic instruction resolvers
 * do). Used as the default semantic-recall query at injection time.
 */
export const lastUserMessage = (ctx: EveContext): string | undefined => {
  const messages = Option.getOrUndefined(decodeMessages(ctx))?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "user") continue
    const text = typeof message.content === "string"
      ? message.content
      : (message.content ?? [])
        .filter((part) => part.type === "text" && part.text !== undefined)
        .map((part) => part.text)
        .join("\n")
    return text === "" ? undefined : text
  }
  return undefined
}
