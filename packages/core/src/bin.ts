#!/usr/bin/env node

/** eve-memory CLI — deliberately dependency-free (node:util.parseArgs) so the
 * library's install footprint stays `effect` only. */

import { Effect } from "effect"
import { parseArgs } from "node:util"
import { runInit } from "./cli/init.js"

const USAGE = `eve-memory — cross-session memory for Vercel eve agents

Usage:
  eve-memory init [options]   Generate the agent wiring files

Options:
  --dir <path>              Agent directory to generate into (default: "agent")
  --embedder <name>         "gateway" (AI Gateway, default) or "stub" (offline)
  --model <id>              Gateway embedding model id
                            (default: "openai/text-embedding-3-small")
  --force                   Overwrite existing files
  -h, --help                Show this help
`

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const main = async () => {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      dir: { type: "string", default: "agent" },
      embedder: { type: "string", default: "gateway" },
      model: { type: "string", default: "openai/text-embedding-3-small" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  })

  if (values.help || positionals.length === 0) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 1)
  }
  if (positionals[0] !== "init") {
    return fail(`Unknown command "${positionals[0]}"\n\n${USAGE}`)
  }
  if (values.embedder !== "gateway" && values.embedder !== "stub") {
    return fail(`--embedder must be "gateway" or "stub", got "${values.embedder}"`)
  }

  await Effect.runPromise(
    runInit({ dir: values.dir, embedder: values.embedder, model: values.model, force: values.force })
  )
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
