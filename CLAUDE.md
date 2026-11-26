# fysio-work-sdk — operational schematics for cc

> This repo is onboarded into [cardmem](https://www.cardmem.com). This file is the operational layer cc reads on every session — conventions, reuse-first defaults, and the rules below. The live cardmem board + the plan-docs under `docs/features/` are the source of truth.

## Project layout

| Area | Path | Notes |
|---|---|---|
| SDK runtime | `src/` | `createModule` (`module.ts`), `strictBody`, allowlist logging, core client, sandbox, CLI (`init`, `check`) |
| Generated TS | `src/generated/` | Zod schemas + core client from `spec/` — never edit by hand; `npm run generate` |
| Contracts | `spec/` | `runtime.json`, `manifest.schema.json`, `module.openapi.json`, `core.openapi.json`, `events.asyncapi.json` |
| Generator | `scripts/generate.mjs` | Builds `src/generated/` from `spec/` |
| Module template | `templates/module/` | What `fysio-work init` copies: manifest, `createModule`, GDPR, tests, CI, `AGENTS.md` |
| Example module | `examples/hello/` | Minimal module with a widget, run by the tests |
| Tests | `test/` | Vitest suites + fake core + `mutations.mjs` (every mutation must turn the suite red) |
| Docs | `docs/` | `first-module.md` (Danish guide, run by tests); plan-docs in `docs/features/` |
| CI | `.github/workflows/` | `publish.yml` (npm via OIDC on `v*` tags), `secret-gate.yml`, `security.yml` |

## Fleet rules (cardmem-owned)

@.claude/fleet.md
@.claude/decisions-index.md

