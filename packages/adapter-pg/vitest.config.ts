import * as path from "node:path"
import { mergeConfig, type UserConfigExport } from "vitest/config"
import shared from "../../vitest.shared.js"

const config: UserConfigExport = {
  test: {
    alias: {
      "eve-memory/adapters": path.join(__dirname, "..", "core", "src", "adapters.ts"),
      "eve-memory": path.join(__dirname, "..", "core", "src", "index.ts")
    }
  }
}

export default mergeConfig(shared, config)
