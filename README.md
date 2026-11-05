# @fysio-work/sdk

The kit every module on **fysio.work** — the platform for physiotherapy clinics — is built with. Our own modules, our partners' and yours.

> **Early access · preview.** `createModule` v0 exists and is tested against a **fake core**. The real platform core is not live yet, so do not run a module in production on this.

## What is here

| Part | Where |
|---|---|
| Contracts as machine-readable specs | `spec/` — `runtime.json`, `manifest.schema.json` (JSON Schema), `module.openapi.json` + `core.openapi.json` (OpenAPI 3.1), `events.asyncapi.json` (AsyncAPI 3) |
| Generated TS (Zod schemas + core client) | `src/generated/` — never edit by hand; `npm run generate` |
| `createModule` v0 on Hono | `src/module.ts` |
| `fysio-work check` v0 | refuses a module that starts its own server instead of `createModule` |

**Strict on input, tolerant on responses.** An unknown field in a call to core or to a module is a `400 unknown_field` — never silently stripped. An unknown field in a response is ignored, so core can add fields without breaking older modules.

## A module

```ts
import { z } from "zod";
import { createModule, strictBody } from "@fysio-work/sdk";

const mod = createModule({
  manifest, // validated against spec/manifest.schema.json — the module does not start if it is invalid
  tickets,  // verifies the ticket on each call
  gdpr: { exportPatient: async (id, ctx) => ({ /* … */ }), deletePatient: async (id, ctx) => {} },
});

mod.app.post("/notes", strictBody(z.object({ text: z.string() })), async (c) => {
  c.var.log.info("note.created", {});           // allowlist logging, never free text
  await c.var.core?.appendAuditEntry({ action: "note.created", outcome: "confirmed" });
  return c.json({ ok: true }, 201);
});

await mod.start(); // SIGTERM: stop new calls, finish the rest within 30 s, close
```

`createModule` sets up: ticket check, clinic context, trace id, allowlist logging (CPR filter as last guard), `/health`, the GDPR endpoints core calls, a readable Danish error on failure, and graceful shutdown.

**It is developer help, not a security boundary.** Everything here runs inside the module's container. Clinic isolation, the audit log and outbound network control are enforced by core, Postgres and the network.

## Not in v0 (waits on platform decisions)

- The ticket bridge between the shell and a module backend, and which ticket a module presents to core (open decisions #1 and #3). `tickets` and `core.ticketFor` are injected until then.
- A real ticket verifier against BID's JWKS.
- Error reporting, per-clinic limits, signed migrations.

## Develop

```sh
npm ci
npm run generate   # after changing spec/
npm run typecheck
npm test           # tests + mutation guard (every mutation must turn the suite red)
```

## License

MIT · broberg.ai, a division of WebHouse ApS
