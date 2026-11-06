import { afterEach, expect, test } from "vitest";
import { runSandbox } from "@fysio-work/sdk/sandbox";
import { buildModule } from "../src/module";

let stop: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function start() {
  const printed: string[] = [];
  const dev = await runSandbox((deps) => buildModule({ ...deps, log: { sink: () => {} } }), {
    port: 0,
    hostname: "127.0.0.1",
    handleSignals: false,
    print: (t) => printed.push(t),
  });
  stop = dev.stop;
  return { ...dev, printed };
}

test("modulet svarer med billet og afviser uden", async () => {
  const dev = await start();
  expect((await fetch(`${dev.base}/health`)).status).toBe(200);
  expect((await fetch(`${dev.base}/`, { headers: dev.user })).status).toBe(200);
  const { authorization, ...withoutTicket } = dev.user;
  expect(authorization).toMatch(/^Bearer /);
  expect((await fetch(`${dev.base}/`, { headers: withoutTicket })).status).toBe(401);
});

test("en note gemmes, logges i platformens revisionslog og kan læses tilbage", async () => {
  const dev = await start();
  const headers = { ...dev.user, "content-type": "application/json" };
  const text = `note ${Date.now()}`;
  const res = await fetch(`${dev.base}/notes`, { method: "POST", headers, body: JSON.stringify({ patientId: "p1", text }) });
  expect(res.status).toBe(201);
  expect(await (await fetch(`${dev.base}/notes`, { headers: dev.user })).json()).toEqual({ notes: [{ patientId: "p1", text }] });
  expect(dev.sandbox.calls.map((c) => c.operation)).toEqual(["appendAuditEntry"]);
});

test("et ukendt felt afvises — det forsvinder aldrig i stilhed", async () => {
  const dev = await start();
  const headers = { ...dev.user, "content-type": "application/json" };
  const res = await fetch(`${dev.base}/notes`, { method: "POST", headers, body: JSON.stringify({ patientId: "p1", text: "x", extra: 1 }) });
  expect(res.status).toBe(400);
});

test("platformen kan eksportere og slette en patients data", async () => {
  const dev = await start();
  const headers = { ...dev.user, "content-type": "application/json" };
  await fetch(`${dev.base}/notes`, { method: "POST", headers, body: JSON.stringify({ patientId: "p1", text: "a" }) });
  const call = (path: string) =>
    fetch(`${dev.base}${path}`, { method: "POST", headers: dev.asCore, body: JSON.stringify({ patientId: "p1" }) });
  expect(await (await call("/_fysio/gdpr/export")).json()).toEqual({ patientId: "p1", data: { notes: ["a"] } });
  expect((await call("/_fysio/gdpr/delete")).status).toBe(200);
  expect(await (await call("/_fysio/gdpr/export")).json()).toEqual({ patientId: "p1", data: { notes: [] } });
});
