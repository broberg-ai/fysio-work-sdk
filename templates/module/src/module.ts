// Dit modul. Alt der står efter createModule(...) ligger bag platformens billet- og
// klinik-tjek — du skriver kun din egen forretningslogik.
import { readFileSync } from "node:fs";
import { createModule, strictBody, z, type CreateModuleOptions } from "@fysio-work/sdk";

export const manifest: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("../fysio-work.manifest.json", import.meta.url), "utf8"),
);

/** Det platformen (eller sandkassen) giver modulet. */
export type ModuleDeps = Pick<CreateModuleOptions, "tickets" | "core" | "env" | "log">;

export function buildModule(deps: ModuleDeps) {
  // Kun i hukommelsen, som eksempel. Modulets rigtige data bor i det lager platformen
  // opretter til modulet i EU — det kommer med platformen.
  const notes = new Map<string, { patientId: string; text: string }[]>();
  const forOrganization = (organizationId: string) => notes.get(organizationId) ?? [];

  const mod = createModule({
    manifest,
    tickets: deps.tickets,
    core: deps.core,
    env: deps.env,
    // Kun navngivne felter logges — aldrig fritekst eller persondata.
    log: { fields: ["noteCount"], ...deps.log },
    gdpr: {
      exportPatient: async (patientId, ctx) => ({
        notes: forOrganization(ctx.organization.id).filter((n) => n.patientId === patientId).map((n) => n.text),
      }),
      deletePatient: async (patientId, ctx) => {
        notes.set(ctx.organization.id, forOrganization(ctx.organization.id).filter((n) => n.patientId !== patientId));
      },
    },
  });

  mod.app.get("/", (c) => c.json({ hej: c.var.principal.subject, organizationId: c.var.organization.id }));

  mod.app.get("/notes", (c) => c.json({ notes: forOrganization(c.var.organization.id) }));

  mod.app.post(
    "/notes",
    strictBody(z.object({ patientId: z.string().min(1).max(128), text: z.string().min(1).max(500) })),
    async (c) => {
      const list = [...forOrganization(c.var.organization.id), c.var.body];
      notes.set(c.var.organization.id, list);
      await c.var.core?.appendAuditEntry({ action: "note.created", outcome: "confirmed" });
      c.var.log.info("note.created", { noteCount: list.length });
      return c.json({ count: list.length }, 201);
    },
  );

  return mod;
}
