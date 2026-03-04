# AGENTS.md

## Project
ZeRo OS monorepo (Bun + TypeScript).

## Goals for Agents
- Deliver minimal, correct, testable changes.
- Prefer small diffs over broad refactors.
- Keep runtime stability for server/websocket/chat flows.

## Tech Stack
- Runtime/package manager: **Bun**
- Language: **TypeScript (ESM)**
- Monorepo: workspaces in `apps/*`, `packages/*`
- Web: Vite + React + Hono + Bun.serve
- E2E: Playwright
- Lint/format: Biome

## Repository Map
- `apps/server`: ZeRo OS bootstrap/CLI/runtime (`src/cli.ts`, `src/main.ts`)
- `apps/web`: UI + API/web server integration (`src/server.ts`)
- `apps/supervisor`: supervisor app entry
- `packages/core|model|memory|observe|secrets|channel|scheduler|supervisor|shared`: domain modules
- `e2e`: end-to-end tests
- `.zero`: local runtime state (logs, memory, secrets, workspace) — treat as operational data

## Critical Safety Rules
1. Never print or commit secret values.
2. Never modify `.zero/secrets.enc` by direct file editing.
3. Do not commit `.zero/*`, `dist`, `node_modules`, `test-results`.
4. Avoid destructive actions unless explicitly requested.
5. Keep changes scoped to requested task only.

## Coding Conventions
- Follow existing style via Biome:
  - 2 spaces
  - single quotes
  - no semicolons
  - line width ~100
- Reuse existing package APIs before introducing new abstractions.
- Keep public exports stable unless task explicitly requires breaking changes.

## Dev Commands (from repo root)
- Install deps: `bun install`
- Type check: `bun run check`
- Lint: `bun run lint`
- Unit/integration tests: `bun run test`
- E2E: `bun run test:e2e`
- Start system: `bun zero start`
- Web dev/build:
  - `bun run dev:web`
  - `bun run build:web`

## Change Workflow for Agents
1. Read related files and understand current behavior.
2. Implement minimal patch.
3. Run validation (at least one):
   - `bun run check` (required for TS changes)
   - `bun run test` (if logic touched)
   - `bun run test:e2e` (if UI/API/session/ws behavior touched)
4. Summarize:
   - files changed
   - why
   - verification commands + results
   - risks / follow-ups

## Task-Specific Guidance
- If touching session/tool/memory flows (`apps/server`, `packages/core|memory|observe`), prioritize regression safety and logging consistency.
- If touching websocket or UI routing (`apps/web`, `e2e/websocket*|navigation*`), run relevant e2e.
- If touching scheduler/channel integrations, preserve backward compatibility and graceful error handling.
