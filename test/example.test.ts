// The example module, started for real on a port, against the fake core.
import { afterEach, expect, test } from "vitest";
import { contracts as c, checkModuleDir } from "../src/index";
import { buildHello } from "../examples/hello/module";
import { createFakeCore } from "./fake-core";
import { fileURLToPath } from "node:url";

const H = c.RUNTIME.headers;
let stop: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

test("the example starts, answers health, and refuses calls without a valid fake-core ticket", async () => {
  const core = createFakeCore();
  const mod = buildHello({ tickets: core.verifier, sink: () => {} });
  const { port } = await mod.start({ port: 0, handleSignals: false });
  stop = () => mod.stop();
  const base = `http://127.0.0.1:${port}`;
  const clinic = { [H.clinicId]: "demo", [H.clinicTicket]: core.issueClinicTicket("demo") };

  const health = await fetch(`${base}/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  expect((await fetch(`${base}/hello`, { headers: clinic })).status).toBe(401);
  expect((await fetch(`${base}/hello`, { headers: { ...clinic, [H.ticket]: "Bearer not-issued" } })).status).toBe(401);

  const ok = await fetch(`${base}/hello`, { headers: { ...clinic, [H.ticket]: `Bearer ${core.issueTicket("user:anna")}` } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ hello: "user:anna", clinicId: "demo" });
});

test("the example passes check", () => {
  expect(checkModuleDir(fileURLToPath(new URL("../examples/hello", import.meta.url)))).toEqual([]);
});
