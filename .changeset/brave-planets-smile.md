---
"eve-memory": minor
"eve-memory-pg": minor
---

Initial release: cross-session memory for Vercel eve agents.

- `defineMemory` Promise API: `save`, `recall`, `getWorkingMemory`, `setWorkingMemory`, `buildInjection`, `resolveIdentity`
- Identity resolution from eve's `session.auth` (initiator → current → anonymous) with `onUnresolvedIdentity` policy
- `inMemoryAdapter` + `stubEmbedder` for development, `gatewayEmbedder` via the AI SDK / Vercel AI Gateway
- `eve-memory-pg`: Postgres/pgvector adapter with idempotent migrations, bring-your-own-client support
- `npx eve-memory init`: codegen for the four agent wiring files (ships with the core package)
