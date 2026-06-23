#!/usr/bin/env node

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { cli } from "./Cli.js"

cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer)),
  NodeRuntime.runMain
)
