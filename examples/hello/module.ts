// Example module: the smallest thing built with createModule. Notes are kept in memory —
// a real module's data lives in the storage core provisions (§3.6), which does not exist yet.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { createModule, strictBody, type CreateModuleOptions } from "../../src/index";

// The manifest lives in fysio-work.manifest.json, so `fysio-work check` can validate it too.
export const manifest: Record<string, unknown> = JSON.parse(readFileSync(new URL("./fysio-work.manifest.json", import.meta.url), "utf8"));

export function buildHello(deps: Pick<CreateModuleOptions, "tickets" | "core" | "env" | "shutdownGraceMs"> & { sink?: NonNullable<CreateModuleOptions["log"]>["sink"] }) {
  const notes = new Map<string, string[]>();
  const mod = createModule({
    manifest,
    tickets: deps.tickets,
    core: deps.core,
    env: deps.env ?? {},
    shutdownGraceMs: deps.shutdownGraceMs,
    log: { fields: ["noteCount"], sink: deps.sink },
    gdpr: {
      exportPatient: async () => ({ notes: [] }),
      deletePatient: async () => {},
    },
  });

  mod.app.get("/hello", (c) => c.json({ hello: c.var.principal.subject, clinicId: c.var.clinic.id }));

  mod.app.post("/notes", strictBody(z.object({ text: z.string().min(1).max(500) })), async (c) => {
    const list = notes.get(c.var.clinic.id) ?? [];
    list.push(c.var.body.text);
    notes.set(c.var.clinic.id, list);
    await c.var.core?.appendAuditEntry({ action: "note.created", outcome: "confirmed" });
    c.var.log.info("note.created", { noteCount: list.length });
    return c.json({ count: list.length }, 201);
  });

  return mod;
}
