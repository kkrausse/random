# Agent Instructions

## Build & Package Manager
- Use **bun** as the package manager and runtime for all commands (e.g., `bun run build`, `bun install`).

## Type Checking
- Prefer `bun run tsc` over a full `bun run build` for quick type validation; it is faster and sufficient for verifying compile-time correctness.
