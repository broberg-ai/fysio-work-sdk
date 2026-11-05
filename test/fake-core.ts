// FAKE core — a test double. The real core does not exist yet (F006.3/F006.4/F006.6).
// It validates requests with the same generated strict schemas the real core must use,
// and can answer with a field "added in a newer MINOR version" to prove client tolerance.
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { contracts as c, parseStrict, type Principal, type TicketVerifier } from "../src/index";

const H = c.RUNTIME.headers;

export interface RecordedCall {
  operation: string;
  ticketSubject: string;
  clinicId: string | undefined;
  clinicTicket: string | undefined;
  traceId: string | undefined;
  body: unknown;
}

export function createFakeCore() {
  const tickets = new Map<string, Principal>();
  const calls: RecordedCall[] = [];
  /** Every request that reached the fake core, accepted or not. */
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

  const responses: Record<keyof typeof c.CORE_OPERATIONS, () => Record<string, unknown>> = {
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
  for (const [name, op] of Object.entries(c.CORE_OPERATIONS) as [keyof typeof c.CORE_OPERATIONS, (typeof c.CORE_OPERATIONS)[keyof typeof c.CORE_OPERATIONS]][]) {
    app.on(op.method, op.path, async (ctx) => {
      hits.push(name);
      const bearer = /^Bearer (\S+)$/.exec(ctx.req.header(H.ticket) ?? "");
      const principal = bearer && tickets.get(bearer[1]);
      const traceId = ctx.req.header(H.traceId) ?? "";
      if (!principal) return ctx.json({ error: { code: "invalid_ticket", message: "x", traceId } }, 401);
      const r = parseStrict<unknown>(requestSchemas[name], await ctx.req.json());
      if (!r.ok) return ctx.json({ error: { code: r.code, message: "x", traceId, fields: r.fields } }, 400);
      calls.push({
        operation: name,
        ticketSubject: principal.subject,
        clinicId: ctx.req.header(H.clinicId),
        clinicTicket: ctx.req.header(H.clinicTicket),
        traceId: ctx.req.header(H.traceId),
        body: r.value,
      });
      const body = responses[name]();
      return ctx.json(addFieldInResponse ? { ...body, addedInMinor: "new" } : body, op.status as 201);
    });
  }

  return {
    baseUrl: "http://fake-core.test",
    app,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch,
    verifier,
    calls,
    hits,
    issueTicket,
    issueClinicTicket,
    revoke: (ticket: string) => tickets.delete(ticket),
    setAddFieldInResponse: (on: boolean) => {
      addFieldInResponse = on;
    },
  };
}
export type FakeCore = ReturnType<typeof createFakeCore>;
