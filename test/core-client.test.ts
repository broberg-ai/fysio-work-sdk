import { beforeEach, describe, expect, test } from "vitest";
import { contracts as c, createCoreClient, CoreError } from "../src/index";
import { createFakeCore, type FakeCore } from "./fake-core";

let core: FakeCore;
let ticket: string;
const clinicTicket = "ct_demo";
const client = () =>
  createCoreClient({
    baseUrl: core.baseUrl,
    fetch: core.fetch,
    context: () => ({ ticket, clinicId: "demo", clinicTicket, traceId: "trace-12345678" }),
  });

beforeEach(() => {
  core = createFakeCore();
  ticket = core.issueTicket("svc:hello");
});

describe("generated core client against the fake core", () => {
  test("sends ticket, clinic, clinic ticket and trace id; returns the parsed response", async () => {
    const r = await client().appendAuditEntry({ action: "note.created", outcome: "confirmed" });
    expect(typeof r.entryId).toBe("string");
    expect(core.calls).toEqual([
      {
        operation: "appendAuditEntry",
        ticketSubject: "svc:hello",
        clinicId: "demo",
        clinicTicket,
        traceId: "trace-12345678",
        body: { action: "note.created", outcome: "confirmed" },
      },
    ]);
  });

  test("an unknown field never leaves the client (strict before sending)", async () => {
    const err = await client()
      .appendAuditEntry({ action: "note.created", outcome: "confirmed", extra: 1 } as never)
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CoreError);
    expect(core.hits).toEqual([]);
  });

  test("a call to core with an unknown field gets 400 unknown_field, not a stripped 2xx", async () => {
    const op = c.CORE_OPERATIONS.appendAuditEntry;
    const res = await core.fetch(new URL(op.path, core.baseUrl), {
      method: op.method,
      headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "note.created", outcome: "confirmed", extra: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: string[] } };
    expect(body.error.code).toBe("unknown_field");
    expect(body.error.fields).toEqual(["extra"]);
    expect(core.calls).toEqual([]);
  });

  test("a field core added in a newer version does not break this client", async () => {
    core.setAddFieldInResponse(true);
    const r = await client().publishEvent({ type: "note.created", data: { n: 1 } });
    expect(Object.keys(r)).toEqual(["eventId"]);
  });

  test("a non-success status becomes a CoreError with the status", async () => {
    core.revoke(ticket);
    const err = await client().createUploadUrl({ fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect(err.status).toBe(401);
    expect(err.operation).toBe("createUploadUrl");
  });
});
