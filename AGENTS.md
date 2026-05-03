# Agent Instructions

- Use **bun** as the package manager and runtime for all commands (e.g., `bun run build`, `bun install`).
- Prefer `bun run tsc` over a full `bun run build` for quick type validation; it is faster and sufficient for verifying compile-time correctness.
- use shadcn ui components whenever possible or if there's a template for it
- this app is deployed on home raspberry pi server via ./scripts/deploy.sh -- if this is asked about, use the ssh alias to interract with the server
- don't do these things unless explicitly asked bc i, the human operator will do this myself
  - run `bun dev`
  - deploy changes
