import * as path from "node:path"
import { defineWorkspace, type UserWorkspaceConfig } from "vitest/config"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const project = (
  config: UserWorkspaceConfig["test"] & { name: `${string}|${string}` },
  root = config.root ?? path.join(__dirname, `packages/${config.name.split("|").at(0)}`)
) => ({
  extends: "vitest.shared.ts",
  test: { root, ...config }
})

export default defineWorkspace([
  "packages/adapter-pg",
  "packages/cli",
  "packages/core"
])
