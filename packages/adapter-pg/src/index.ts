/** eve-memory-pg — Postgres/pgvector storage adapter for eve-memory */

import { Clock, Effect, Layer, Option, type ParseResult, Schema } from "effect"
import { Memory, MemoryStorageError } from "eve-memory"
import type {
  MemoryEntry,
  MemorySearchResult,
  SearchMemoryInput,
  WorkingMemoryKey
} from "eve-memory"

/**
 * The minimal query surface the adapter needs. Structurally satisfied by
 * `pg.Pool`, `pg.Client`, Neon's serverless driver, and PGlite — pass
 * whichever client your deployment already has.
 */
export interface PgQuerier {
  readonly query: (sql: string, params?: Array<unknown>) => Promise<{ rows: Array<unknown> }>
}

export type PgConnection =
  /** Use an existing client/pool. The caller owns its lifecycle. */
  | { readonly client: PgQuerier }
  /** Create a `pg.Pool` from a connection string. Requires `pg` installed; closed on dispose. */
  | { readonly connectionString: string }

export type PgMemoryAdapterOptions = PgConnection & {
  /**
   * Embedding dimension of the `vector` column — must match your embedder
   * (e.g. 1536 for openai/text-embedding-3-small).
   */
  readonly dimensions: number
  /** Table name prefix (default "eve_memory"). Lowercase letters, digits, underscores. */
  readonly tablePrefix?: string
}

type Operation = ConstructorParameters<typeof MemoryStorageError>[0]["operation"]

const EntryRow = Schema.Struct({
  id: Schema.String,
  resource_id: Schema.String,
  thread_id: Schema.String,
  content: Schema.String,
  created_at: Schema.Union(Schema.DateFromSelf, Schema.Date)
})

const SearchRow = Schema.Struct({ ...EntryRow.fields, score: Schema.Number })

const WorkingMemoryRow = Schema.Struct({ content: Schema.String })

const decodeEntryRows = Schema.decodeUnknown(Schema.Array(EntryRow))
const decodeSearchRows = Schema.decodeUnknown(Schema.Array(SearchRow))
const decodeWorkingMemoryRows = Schema.decodeUnknown(Schema.Array(WorkingMemoryRow))

const toEntry = (row: typeof EntryRow.Type): MemoryEntry => ({
  id: row.id,
  resourceId: row.resource_id,
  threadId: row.thread_id,
  content: row.content,
  createdAt: row.created_at
})

/** pgvector accepts the JSON array literal syntax for vector values. */
const toVectorLiteral = (embedding: ReadonlyArray<number>) => JSON.stringify(embedding)

/**
 * One statement per entry: PGlite (and other extended-protocol clients)
 * reject multi-statement strings, and every statement is idempotent.
 */
const migrationStatements = (prefix: string, dimensions: number): ReadonlyArray<string> => [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS ${prefix}_entries (
    id text PRIMARY KEY,
    resource_id text NOT NULL,
    thread_id text NOT NULL,
    content text NOT NULL,
    embedding vector(${dimensions}) NOT NULL,
    seq bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${prefix}_entries_scope_idx
    ON ${prefix}_entries (resource_id, thread_id)`,
  `CREATE TABLE IF NOT EXISTS ${prefix}_working (
    scope text NOT NULL,
    resource_id text NOT NULL,
    thread_id text NOT NULL,
    content text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (scope, resource_id, thread_id)
  )`
]

/** Working-memory rows use thread_id = '' for resource scope, keeping one natural key. */
const workingMemoryParams = (key: WorkingMemoryKey) => [
  key.scope,
  key.resourceId,
  key.scope === "resource" ? "" : key.threadId
]

const acquireClient = (options: PgMemoryAdapterOptions) =>
  "client" in options
    ? Effect.succeed(options.client)
    : Effect.acquireRelease(
      Effect.promise(async () => {
        const { default: pg } = await import("pg")
        return new pg.Pool({ connectionString: options.connectionString })
      }),
      (pool) => Effect.promise(() => pool.end())
    )

/**
 * Postgres storage adapter backed by pgvector cosine distance. The layer
 * runs an idempotent migration at construction; connection and migration
 * failures are configuration errors and fail fast (die).
 */
export const pgMemoryAdapter = (options: PgMemoryAdapterOptions): Layer.Layer<Memory> =>
  Layer.scoped(
    Memory,
    Effect.gen(function*() {
      const prefix = options.tablePrefix ?? "eve_memory"
      if (!/^[a-z_][a-z0-9_]*$/.test(prefix)) {
        return yield* Effect.dieMessage(
          `eve-memory-pg: invalid tablePrefix "${prefix}" — use lowercase letters, digits, underscores`
        )
      }
      const entries = `${prefix}_entries`
      const working = `${prefix}_working`

      const client = yield* acquireClient(options)

      const run = (operation: Operation, sql: string, params?: Array<unknown>) =>
        Effect.tryPromise({
          try: () => client.query(sql, params),
          catch: (cause) => new MemoryStorageError({ operation, cause })
        })

      const decoded = <A>(
        operation: Operation,
        decoder: (rows: unknown) => Effect.Effect<A, ParseResult.ParseError>
      ) =>
      (rows: Array<unknown>) =>
        decoder(rows).pipe(
          Effect.mapError((cause) => new MemoryStorageError({ operation, cause }))
        )

      yield* Effect.forEach(
        migrationStatements(prefix, options.dimensions),
        (statement) => Effect.promise(() => client.query(statement))
      ).pipe(Effect.orDie)

      const neighborsOf = (entry: MemoryEntry, range: number) =>
        Effect.gen(function*() {
          if (range <= 0) return [] as ReadonlyArray<MemoryEntry>
          const result = yield* run(
            "search",
            `WITH thread AS (
               SELECT id, resource_id, thread_id, content, created_at,
                      row_number() OVER (ORDER BY seq) AS rn
               FROM ${entries}
               WHERE resource_id = $1 AND thread_id = $2
             ), anchor AS (
               SELECT rn FROM thread WHERE id = $3
             )
             SELECT t.id, t.resource_id, t.thread_id, t.content, t.created_at
             FROM thread t, anchor a
             WHERE t.rn BETWEEN a.rn - $4 AND a.rn + $4 AND t.id <> $3
             ORDER BY t.rn`,
            [entry.resourceId, entry.threadId, entry.id, range]
          )
          const rows = yield* decoded("search", decodeEntryRows)(result.rows)
          return rows.map(toEntry)
        })

      return {
        store: (input) =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            const entry: MemoryEntry = {
              id: `mem_${crypto.randomUUID()}`,
              resourceId: input.resourceId,
              threadId: input.threadId,
              content: input.content,
              createdAt: new Date(now)
            }
            yield* run(
              "store",
              `INSERT INTO ${entries} (id, resource_id, thread_id, content, embedding, created_at)
               VALUES ($1, $2, $3, $4, $5::vector, $6)`,
              [entry.id, entry.resourceId, entry.threadId, entry.content, toVectorLiteral(input.embedding), entry.createdAt]
            )
            return entry
          }),

        search: (input: SearchMemoryInput) =>
          Effect.gen(function*() {
            const result = yield* run(
              "search",
              `SELECT id, resource_id, thread_id, content, created_at,
                      1 - (embedding <=> $1::vector) AS score
               FROM ${entries}
               WHERE resource_id = $2
                 AND ($3::text IS NULL OR thread_id = $3)
                 AND 1 - (embedding <=> $1::vector) >= $4
               ORDER BY embedding <=> $1::vector
               LIMIT $5`,
              [
                toVectorLiteral(input.embedding),
                input.resourceId,
                input.scope === "thread" ? input.threadId : null,
                input.threshold,
                input.topK
              ]
            )
            const rows = yield* decoded("search", decodeSearchRows)(result.rows)
            const matches: Array<MemorySearchResult> = []
            for (const row of rows) {
              const entry = toEntry(row)
              matches.push({
                entry,
                score: row.score,
                neighbors: yield* neighborsOf(entry, input.messageRange)
              })
            }
            return matches
          }),

        remove: (id) => run("remove", `DELETE FROM ${entries} WHERE id = $1`, [id]).pipe(Effect.asVoid),

        getWorkingMemory: (key) =>
          Effect.gen(function*() {
            const result = yield* run(
              "getWorkingMemory",
              `SELECT content FROM ${working} WHERE scope = $1 AND resource_id = $2 AND thread_id = $3`,
              workingMemoryParams(key)
            )
            const rows = yield* decoded("getWorkingMemory", decodeWorkingMemoryRows)(result.rows)
            return Option.fromNullable(rows[0]?.content)
          }),

        setWorkingMemory: (key, content) =>
          run(
            "setWorkingMemory",
            `INSERT INTO ${working} (scope, resource_id, thread_id, content, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (scope, resource_id, thread_id)
             DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
            [...workingMemoryParams(key), content]
          ).pipe(Effect.asVoid)
      }
    })
  )
