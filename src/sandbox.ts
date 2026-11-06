// Local sandbox — a FAKE core for developing a module on your own machine (plan F006 §11
// fase 3 trin 4). The real core does not exist yet (F006.3/F006.4/F006.6). The sandbox
// validates requests with the same generated strict schemas the real core must use, and
// can answer with a field "added in a newer MINOR version" to prove client tolerance.
//
// Never use this in production: it accepts every ticket it issued itself, and nothing else.
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { CORE_OPERATIONS, MODULE_OPERATIONS, RUNTIME } from "./generated/contracts";
import * as c from "./generated/contracts";
import { parseStrict } from "./strict";
import type { CreateModuleOptions, FysioModule, Principal, TicketVerifier } from "./module";

const H = RUNTIME.headers;

export interface RecordedCall {
  operation: string;
  ticketSubject: string;
  clinicId: string | undefined;
  clinicTicket: string | undefined;
  traceId: string | undefined;
  body: unknown;
}

export interface SandboxOptions {
  /** Called for every call core accepted. */
  onCall?: (call: RecordedCall) => void;
}

export function createSandbox(options: SandboxOptions = {}) {
  const tickets = new Map<string, Principal>();
  const calls: RecordedCall[] = [];
  /** Every request that reached the sandbox core, accepted or not. */
  const hits: string[] = [];
  let addFieldInResponse = false;

  const issueTicket = (subject: string) => {
    const t = `tk_${randomUUID()}`;
    tickets.set(t, { subject });
    return t;
  };
  const issueClinicTicket = (clinicId: string) => `ct_${clinicId}_${randomUUID()}`;
  const verifier: TicketVerifier = {
    async verify(ticket) {
      const p = tickets.get(ticket);
      if (!p) throw new Error("unknown ticket");
      return p;
    },
  };

  const responses: Record<keyof typeof CORE_OPERATIONS, () => Record<string, unknown>> = {
    appendAuditEntry: () => ({ entryId: randomUUID(), recordedAt: new Date().toISOString() }),
    createUploadUrl: () => ({
      url: "https://files.example.eu/upload/abc",
      method: "PUT",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    publishEvent: () => ({ eventId: randomUUID() }),
  };
  const requestSchemas = {
    appendAuditEntry: c.AuditEntryRequestStrict,
    createUploadUrl: c.UploadUrlRequestStrict,
    publishEvent: c.EventPublishRequestStrict,
  } as const;

  const app = new Hono();
  for (const [name, op] of Object.entries(CORE_OPERATIONS) as [keyof typeof CORE_OPERATIONS, (typeof CORE_OPERATIONS)[keyof typeof CORE_OPERATIONS]][]) {
    app.on(op.method, op.path, async (ctx) => {
      hits.push(name);
      const bearer = /^Bearer (\S+)$/.exec(ctx.req.header(H.ticket) ?? "");
      const principal = bearer && tickets.get(bearer[1]);
      const traceId = ctx.req.header(H.traceId) ?? "";
      if (!principal) return ctx.json({ error: { code: "invalid_ticket", message: "Billetten er ugyldig.", traceId } }, 401);
      const r = parseStrict<unknown>(requestSchemas[name], await ctx.req.json());
      if (!r.ok) return ctx.json({ error: { code: r.code, message: "Kaldet er ugyldigt.", traceId, fields: r.fields } }, 400);
      const call: RecordedCall = {
        operation: name,
        ticketSubject: principal.subject,
        clinicId: ctx.req.header(H.organizationId),
        clinicTicket: ctx.req.header(H.clinicTicket),
        traceId: ctx.req.header(H.traceId),
        body: r.value,
      };
      calls.push(call);
      options.onCall?.(call);
      const body = responses[name]();
      return ctx.json(addFieldInResponse ? { ...body, addedInMinor: "new" } : body, op.status as 201);
    });
  }

  const baseUrl = "http://sandbox-core.local";
  const fetchCore = ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;

  return {
    baseUrl,
    app,
    fetch: fetchCore,
    verifier,
    calls,
    hits,
    issueTicket,
    issueClinicTicket,
    revoke: (ticket: string) => tickets.delete(ticket),
    setAddFieldInResponse: (on: boolean) => {
      addFieldInResponse = on;
    },
    /**
     * `core` options for createModule, wired to this sandbox. The module presents a service
     * ticket for `svc:<moduleId()>` — which ticket a module presents to the real core is OPEN
     * decision #1 (F006.2), so this is the sandbox's choice, not the platform's.
     */
    coreFor(moduleId: () => string): NonNullable<CreateModuleOptions["core"]> {
      return { baseUrl, fetch: fetchCore, ticketFor: () => issueTicket(`svc:${moduleId()}`) };
    },
  };
}
export type Sandbox = ReturnType<typeof createSandbox>;

/** What your module needs from the sandbox. Pass it straight on to createModule. */
export type SandboxDeps = Pick<CreateModuleOptions, "tickets" | "core" | "env">;

export interface ExampleCall {
  title: string;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface RunSandboxOptions {
  /** Port for the module (default PORT or RUNTIME.defaultPort; 0 = any free port). */
  port?: number;
  hostname?: string;
  clinicId?: string;
  /** Where the welcome text goes (default console.log). */
  print?: (text: string) => void;
  /** Stop on SIGTERM / Ctrl-C (default true). */
  handleSignals?: boolean;
}

/**
 * Start your module against the sandbox, in one process, and print ready-made calls with a
 * ticket and clinic context. This is what `npm run dev` in a new module runs.
 */
export async function runSandbox(build: (deps: SandboxDeps) => FysioModule, options: RunSandboxOptions = {}) {
  const print = options.print ?? ((t: string) => console.log(t));
  const clinicId = options.clinicId ?? "sandkasse-klinik";
  let mod: FysioModule | undefined;
  const sandbox = createSandbox({
    onCall: (call) => print(`sandkasse-core: ${call.operation} fra ${call.ticketSubject} (klinik ${call.clinicId})`),
  });
  mod = build({ tickets: sandbox.verifier, core: sandbox.coreFor(() => mod!.manifest.id), env: process.env });
  const handleSignals = options.handleSignals !== false;
  const { port } = await mod.start({ port: options.port, hostname: options.hostname, handleSignals });
  if (handleSignals) process.once("SIGINT", () => void mod!.stop().then(() => process.exit(0)));

  const base = `http://${options.hostname ?? "localhost"}:${port}`;
  const clinic = { [H.organizationId]: clinicId, [H.clinicTicket]: sandbox.issueClinicTicket(clinicId) };
  const user = { [H.ticket]: `Bearer ${sandbox.issueTicket("user:sandkasse-bruger")}`, ...clinic };
  const asCore = { [H.ticket]: `Bearer ${sandbox.issueTicket(RUNTIME.coreSubject)}`, ...clinic, "content-type": "application/json" };
  const examples: ExampleCall[] = [
    { title: "Lever modulet?", method: "GET", url: `${base}${MODULE_OPERATIONS.health.path}`, headers: {} },
    { title: "Et kald med billet og klinik", method: "GET", url: `${base}/`, headers: user },
    { title: "Uden billet afvises kaldet (401)", method: "GET", url: `${base}/`, headers: clinic },
    {
      title: "Platformen beder om en patients data (GDPR-eksport)",
      method: "POST",
      url: `${base}${MODULE_OPERATIONS.exportPatient.path}`,
      headers: asCore,
      body: { patientId: "patient-1" },
    },
  ];

  print(
    [
      "",
      `Modulet «${mod.manifest.name}» kører mod sandkassen på ${base}`,
      "Sandkassen er en falsk platform på din egen maskine — intet forlader den.",
      "",
      ...examples.flatMap((e) => [`# ${e.title}`, toCurl(e), ""]),
      `Billetterne gælder, til du stopper med Ctrl-C. Brugerens billet: ${user[H.ticket]}`,
    ].join("\n"),
  );

  return { port, base, sandbox, module: mod, examples, user, asCore, stop: () => mod!.stop() };
}

export function toCurl(e: ExampleCall): string {
  const parts = ["curl -i"];
  if (e.method !== "GET") parts.push(`-X ${e.method}`);
  for (const [k, v] of Object.entries(e.headers)) parts.push(`-H '${k}: ${v}'`);
  if (e.body !== undefined) parts.push(`-d '${JSON.stringify(e.body)}'`);
  parts.push(`'${e.url}'`);
  return parts.join(" ");
}
