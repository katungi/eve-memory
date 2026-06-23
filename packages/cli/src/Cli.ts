import { Command } from "@effect/cli"
import { runInit } from "./codegen/init.js"

const init = Command.make("init").pipe(
  Command.withDescription("Initialize eve-memory in an eve agent project"),
  Command.withHandler(() => runInit())
)

const root = Command.make("eve-memory").pipe(
  Command.withSubcommands([init])
)

export const cli = Command.run(root, {
  name: "eve-memory",
  version: "0.0.0"
})
