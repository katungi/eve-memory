import { Command, Options } from "@effect/cli"
import { runInit } from "./codegen/init.js"

const dir = Options.text("dir").pipe(
  Options.withDescription("Agent directory to generate into"),
  Options.withDefault("agent")
)

const embedder = Options.choice("embedder", ["gateway", "stub"]).pipe(
  Options.withDescription("Embedder to configure: AI Gateway (real) or the deterministic stub"),
  Options.withDefault("gateway" as const)
)

const model = Options.text("model").pipe(
  Options.withDescription("Gateway embedding model id"),
  Options.withDefault("openai/text-embedding-3-small")
)

const force = Options.boolean("force").pipe(
  Options.withDescription("Overwrite existing files")
)

const init = Command.make("init", { dir, embedder, force, model }).pipe(
  Command.withDescription("Generate eve-memory wiring files in an eve agent project"),
  Command.withHandler((options) => runInit(options))
)

const root = Command.make("eve-memory").pipe(
  Command.withSubcommands([init])
)

export const cli = Command.run(root, {
  name: "eve-memory",
  version: "0.0.0"
})
