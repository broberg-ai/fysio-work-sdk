import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { contracts as c, createModule, ModuleStartError, parseStrict, REDACTED, strictBody, strippedKeys } from "../src/index";
import { buildHello, manifest } from "../examples/hello/module";
import { createFakeCore, type FakeCore } from "./fake-core";
import type { TicketTarget } from "../src/sandbox";

const H = c.RUNTIME.headers;
let core: FakeCore;
let lines: Record<string, unknown>[];

beforeEach(() => {
  core = createFakeCore();
  lines = [];
});

const sink = (l: Record<string, unknown>) => void lines.push(l);
const hello = (extra: Partial<Parameters<typeof buildHello>[0]> = {}) =>
  buildHello({ tickets: core.verifier, sink, ...extra });

function headers(subject = "user:anna", organizationId = "demo", more: Record<string, string> = {}, to: Partial<TicketTarget> = {}) {
  return {
    [H.ticket]: `Bearer ${core.issueTicket(subject, { organizationId, moduleId: "hello", ...to })}`,
    [H.organizationId]: organizationId,
    [H.organizationTicket]: core.issueOrganizationTicket(organizationId),
    "content-type": "application/json",
    ...more,
  };
}

describe("start: manifest and config", () => {
  test("an invalid manifest does not start and says where", () => {
    expect(() => buildModule({ ...manifest, id: "Bad Id" })).toThrow(new ModuleStartError("Manifestet er ugyldigt: id"));
  });
  test("an unknown manifest field does not start", () => {
    expect(() => buildModule({ ...manifest, extra: 1 })).toThrow(/Manifestet er ugyldigt/);
  });
  test("missing config does not start and names every missing value", () => {
    expect(() => buildModule({ ...manifest, config: { required: ["A_KEY", "B_KEY"] } }, { A_KEY: "x" })).toThrow(
      new ModuleStartError("Mangler konfiguration: B_KEY"),
    );
  });
  test("a ticket verifier without an issuer does not start (F006.34 L2)", () => {
    for (const issuer of ["", undefined]) {
      expect(() =>
        createModule({
          manifest,
          env: {},
          tickets: { issuer: issuer as never, verify: core.verifier.verify },
          log: { sink },
          gdpr: { exportPatient: async () => ({}), deletePatient: async () => {} },
        }),
      ).toThrow(new ModuleStartError("Billet-tjekket mangler core's issuer."));
    }
  });
  test("present config is exposed", () => {
    expect(buildModule({ ...manifest, config: { required: ["A_KEY"] } }, { A_KEY: "x" }).config).toEqual({ A_KEY: "x" });
  });
});

function buildModule(m: unknown, env: Record<string, string> = {}) {
  return createModule({
    manifest: m,
    env,
    tickets: core.verifier,
    log: { sink },
    gdpr: { exportPatient: async () => ({}), deletePatient: async () => {} },
  });
}

describe("health and trace id", () => {
  test("/health answers without a ticket", async () => {
    const res = await hello().app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
  test("a valid incoming trace id is echoed; a missing or invalid one is replaced", async () => {
    const mod = hello();
    expect((await mod.app.request("/health", { headers: { [H.traceId]: "abc-12345678" } })).headers.get(H.traceId)).toBe("abc-12345678");
    const generated = (await mod.app.request("/health", { headers: { [H.traceId]: "bad id!" } })).headers.get(H.traceId);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect((await mod.app.request("/hello")).headers.get(H.traceId)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("ticket check and organization context", () => {
  test("no ticket -> 401 missing_ticket", async () => {
    const res = await hello().app.request("/hello");
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("missing_ticket");
  });
  test("a ticket the fake core never issued -> 401 invalid_ticket", async () => {
    const res = await hello().app.request("/hello", { headers: { ...headers(), [H.ticket]: "Bearer forged" } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("invalid_ticket");
  });
  test("an unknown route is also behind the ticket check", async () => {
    expect((await hello().app.request("/nope")).status).toBe(401);
  });
  test("valid ticket but no organization -> 400 missing_organization", async () => {
    const { [H.organizationId]: _drop, ...h } = headers();
    const res = await hello().app.request("/hello", { headers: h });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("missing_organization");
  });
  test("the organisation header is x-fysio-organization-id; the old x-fysio-clinic-id is not read", async () => {
    expect(H.organizationId).toBe("x-fysio-organization-id");
    const { [H.organizationId]: id, ...h } = headers();
    const res = await hello().app.request("/hello", { headers: { ...h, "x-fysio-clinic-id": id! } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("missing_organization");
  });
  test("the organization ticket header is x-fysio-organization-ticket; the old x-fysio-clinic-ticket is not read", async () => {
    expect(H.organizationTicket).toBe("x-fysio-organization-ticket");
    const { [H.organizationTicket]: t, ...h } = headers();
    const res = await hello().app.request("/hello", { headers: { ...h, "x-fysio-clinic-ticket": t! } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("missing_organization");
  });
  test("a ticket for organization A with header B -> 403 organization_mismatch, handler not run (F006.34)", async () => {
    const mod = hello();
    const res = await mod.app.request("/notes", {
      method: "POST",
      headers: { ...headers("user:anna", "org-a"), [H.organizationId]: "org-b", [H.organizationTicket]: core.issueOrganizationTicket("org-b") },
      body: JSON.stringify({ text: "hej" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("organization_mismatch");
    const own = await mod.app.request("/notes", { method: "POST", headers: headers("user:anna", "org-b"), body: JSON.stringify({ text: "hej" }) });
    expect(await own.json()).toEqual({ count: 1 }); // nothing was written to org-b by the forged call
  });
  test("a ticket for another module (aud) -> 401 invalid_ticket", async () => {
    const res = await hello().app.request("/hello", { headers: headers("user:anna", "demo", {}, { moduleId: "notes" }) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("invalid_ticket");
    const exact = await hello().app.request("/hello", { headers: headers("user:anna", "demo", {}, { audience: "module:hello-x" }) });
    expect(exact.status).toBe(401);
  });
  test("a ticket from another issuer than core -> 401 invalid_ticket", async () => {
    const res = await hello().app.request("/hello", { headers: headers("user:anna", "demo", {}, { issuer: "https://evil.example" }) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("invalid_ticket");
  });
  test("a ticket without claims (no iss, aud, org) -> 401 invalid_ticket", async () => {
    const res = await hello().app.request("/hello", { headers: { ...headers(), [H.ticket]: `Bearer ${core.issueTicket("user:anna")}` } });
    expect(res.status).toBe(401);
  });
  test("data_scope none -> 403 no_data_scope; self and organization are let through", async () => {
    const none = await hello().app.request("/hello", { headers: headers("user:dev", "demo", {}, { dataScope: "none" }) });
    expect(none.status).toBe(403);
    expect(((await none.json()) as any).error.code).toBe("no_data_scope");
    for (const dataScope of ["self", "organization"] as const) {
      expect((await hello().app.request("/hello", { headers: headers("user:carl", "demo", {}, { dataScope }) })).status).toBe(200);
    }
  });
  test("valid ticket + organization -> the handler sees principal and organization", async () => {
    const res = await hello().app.request("/hello", { headers: headers("user:anna", "org-b") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "user:anna", organizationId: "org-b" });
  });
});

describe("strict on input to a module", () => {
  test("an unknown body field -> 400 unknown_field naming it, handler not run", async () => {
    const mod = hello();
    const res = await mod.app.request("/notes", { method: "POST", headers: headers(), body: JSON.stringify({ text: "hej", extra: 1 }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("unknown_field");
    expect(body.error.fields).toEqual(["extra"]);
    const ok = await mod.app.request("/notes", { method: "POST", headers: headers(), body: JSON.stringify({ text: "hej" }) });
    expect(await ok.json()).toEqual({ count: 1 });
  });
  test("a nested unknown field is found even when the developer's schema would strip it", () => {
    const schema = z.object({ a: z.object({ b: z.string() }), list: z.array(z.object({ x: z.number() })) });
    const r = parseStrict(schema, { a: { b: "1", hidden: 2 }, list: [{ x: 1 }, { x: 2, y: 3 }] });
    expect(r).toEqual({ ok: false, code: "unknown_field", fields: ["a.hidden", "list[1].y"] });
    expect(strippedKeys({ a: 1 }, { a: 1 })).toEqual([]);
  });
  test("invalid JSON -> 400 invalid_json", async () => {
    const res = await hello().app.request("/notes", { method: "POST", headers: headers(), body: "{nope" });
    expect(((await res.json()) as any).error.code).toBe("invalid_json");
  });
});

describe("GDPR endpoints (only core may call)", () => {
  const exp = c.MODULE_OPERATIONS.exportPatient;
  const del = c.MODULE_OPERATIONS.deletePatient;
  test("a user ticket is refused with 403", async () => {
    const res = await hello().app.request(exp.path, { method: exp.method, headers: headers("user:anna"), body: JSON.stringify({ patientId: "p1" }) });
    expect(res.status).toBe(403);
  });
  test("core's service ticket gets export and delete", async () => {
    const mod = hello();
    const e = await mod.app.request(exp.path, { method: exp.method, headers: headers(c.RUNTIME.coreSubject), body: JSON.stringify({ patientId: "p1" }) });
    expect(e.status).toBe(exp.status);
    expect(await e.json()).toEqual({ patientId: "p1", data: { notes: [] } });
    const d = await mod.app.request(del.path, { method: del.method, headers: headers(c.RUNTIME.coreSubject), body: JSON.stringify({ patientId: "p1" }) });
    expect(await d.json()).toEqual({ patientId: "p1", deleted: true });
  });
  test("an unknown field in core's request -> 400", async () => {
    const res = await hello().app.request(del.path, {
      method: del.method,
      headers: headers(c.RUNTIME.coreSubject),
      body: JSON.stringify({ patientId: "p1", cascade: true }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.fields).toEqual(["cascade"]);
  });
});

describe("calls to core carry the request's context", () => {
  test("trace id, organization and organization ticket are forwarded; the ticket comes from ticketFor", async () => {
    const svc = core.issueTicket("svc:hello");
    const mod = hello({ core: { baseUrl: core.baseUrl, fetch: core.fetch, ticketFor: () => svc } });
    const h = headers("user:anna", "demo", { [H.traceId]: "trace-abcdef12" });
    const res = await mod.app.request("/notes", { method: "POST", headers: h, body: JSON.stringify({ text: "hej" }) });
    expect(res.status).toBe(201);
    expect(core.calls).toEqual([
      {
        operation: "appendAuditEntry",
        ticketSubject: "svc:hello",
        organizationId: "demo",
        organizationTicket: h[H.organizationTicket],
        traceId: "trace-abcdef12",
        body: { action: "note.created", outcome: "confirmed" },
      },
    ]);
  });
});

describe("allowlist logging", () => {
  test("each request logs route, status, duration, trace and organization", async () => {
    await hello().app.request("/hello", { headers: headers("user:anna", "demo", { [H.traceId]: "trace-abcdef12" }) });
    const done = lines.find((l) => l.event === "request.done")!;
    expect(done).toMatchObject({ level: "info", method: "GET", route: "/hello", status: 200, traceId: "trace-abcdef12", organizationId: "demo" });
    expect(typeof done.durationMs).toBe("number");
  });
  test("fields not on the allowlist are dropped, not written", async () => {
    const mod = hello();
    mod.log.info("note.created", { noteCount: 2, patientName: "Anna Hansen", nested: { a: 1 } as never });
    expect(lines.at(-1)).toMatchObject({ event: "note.created", noteCount: 2, droppedFields: ["nested", "patientName"] });
    expect(JSON.stringify(lines.at(-1))).not.toContain("Anna");
  });
  test("a CPR number in an allowed field is redacted", () => {
    hello().log.info("x.y", { route: "/p/010190-1234/and/0101901234" });
    expect(lines.at(-1)!.route).toBe(`/p/${REDACTED}/and/${REDACTED}`);
  });
  test("a free-text event name is not written", () => {
    hello().log.info("Anna Hansen ringede", {});
    expect(lines.at(-1)!.event).toBe("invalid_event_name");
  });
  test("a thrown error gives a Danish 500 and logs only the error's name", async () => {
    const mod = hello();
    mod.app.get("/boom", () => {
      throw new TypeError("patient 010190-1234 Anna");
    });
    const res = await mod.app.request("/boom", { headers: headers() });
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error).toMatchObject({ code: "internal", message: "Der opstod en fejl i modulet." });
    expect(lines.find((l) => l.event === "request.error")).toMatchObject({ errorName: "TypeError" });
    expect(JSON.stringify(lines)).not.toContain("Anna");
  });
});

describe("shutdown", () => {
  afterEach(() => vi.restoreAllMocks());

  test("stop: new calls get 503, the call in flight finishes, then the server closes", async () => {
    const mod = hello();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let arrived!: () => void;
    const reached = new Promise<void>((r) => (arrived = r));
    mod.app.get("/slow", async (c) => {
      arrived();
      await gate;
      return c.json({ done: true });
    });
    const { port } = await mod.start({ port: 0, handleSignals: false });
    const base = `http://127.0.0.1:${port}`;
    const slow = fetch(`${base}/slow`, { headers: headers() });
    await reached; // /slow is in its handler — no timing guess
    const stopping = mod.stop();
    expect(mod.draining).toBe(true);
    expect((await mod.app.request("/hello", { headers: headers() })).status).toBe(503);
    const health = await mod.app.request("/health");
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ status: "draining" });
    release();
    expect((await slow).status).toBe(200);
    expect(await stopping).toEqual({ timedOut: false });
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  });

  test("a call that outlives the grace period does not hold shutdown forever", async () => {
    const mod = hello({ shutdownGraceMs: 50 });
    let arrived!: () => void;
    const reached = new Promise<void>((r) => (arrived = r));
    mod.app.get("/hang", () => {
      arrived();
      return new Promise<Response>(() => {});
    });
    void mod.app.request("/hang", { headers: headers() });
    await reached;
    expect(await mod.stop()).toEqual({ timedOut: true });
    expect(lines.find((l) => l.event === "shutdown.done")).toMatchObject({ timedOut: true, inflight: 1 });
  });

  test("SIGTERM drains and exits", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const mod = hello();
    await mod.start({ port: 0 });
    process.emit("SIGTERM");
    await vi.waitUntil(() => exit.mock.calls.length > 0, { timeout: 2000 });
    expect(exit).toHaveBeenCalledWith(0);
    expect(mod.draining).toBe(true);
  });
});
