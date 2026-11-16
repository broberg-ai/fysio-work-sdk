// F007 — widgets: the manifest declares them, createModule answers them, and nothing undeclared gets through.
import { beforeEach, describe, expect, test } from "vitest";
import { checkManifest, contracts as c, createModule, ModuleStartError } from "../src/index";
import { buildHello, manifest } from "../examples/hello/module";
import { createFakeCore, type FakeCore } from "./fake-core";

const H = c.RUNTIME.headers;
let core: FakeCore;
beforeEach(() => {
  core = createFakeCore();
});
const hello = () => buildHello({ tickets: core.verifier, sink: () => {} });
const headers = (organizationId = "demo") => ({
  [H.ticket]: `Bearer ${core.issueTicket("user:anna", { organizationId, moduleId: "hello" })}`,
  [H.organizationId]: organizationId,
  [H.organizationTicket]: core.issueOrganizationTicket(organizationId),
  "content-type": "application/json",
});
const ask = (mod: ReturnType<typeof hello>, body: unknown, org = "demo") =>
  mod.app.request(c.MODULE_OPERATIONS.widgetContent.path, { method: "POST", headers: headers(org), body: JSON.stringify(body) });
const build = (m: unknown, widgets?: Record<string, () => Promise<{ content: Record<string, unknown> }>>) =>
  createModule({ manifest: m, env: {}, tickets: core.verifier, log: { sink: () => {} }, gdpr: { exportPatient: async () => ({}), deletePatient: async () => {} }, widgets });

describe("widget content", () => {
  test("a declared widget answers with its kind from the manifest and the user's organisation's data", async () => {
    const mod = hello();
    await mod.app.request("/notes", { method: "POST", headers: headers("demo"), body: JSON.stringify({ text: "x" }) });
    const res = await ask(mod, { widgetId: "noter", size: "half" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ widgetId: "noter", kind: "stat", content: { value: 1, label: "note" }, actions: [{ label: "Skriv en note", href: "/notes" }] });
    // another organisation sees its own count, not demo's
    expect((await (await ask(mod, { widgetId: "noter", size: "half" }, "other")).json()).content).toEqual({ value: 0, label: "noter" });
  });
  test("an undeclared widget is 404 unknown_widget", async () => {
    const res = await ask(hello(), { widgetId: "andet", size: "half" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("unknown_widget");
  });
  test("a size the widget does not support is refused", async () => {
    const res = await ask(hello(), { widgetId: "noter", size: "full" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unsupported_size");
  });
  test("no ticket, no widget", async () => {
    const res = await hello().app.request(c.MODULE_OPERATIONS.widgetContent.path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ widgetId: "noter", size: "half" }) });
    expect(res.status).toBe(401);
  });
});

describe("widgets at start", () => {
  const w = { id: "noter", title: "Noter", kind: "stat", sizes: ["half"] };
  test("an unknown kind is an invalid manifest", () => {
    expect(() => build({ ...manifest, widgets: [{ ...w, kind: "kage" }] })).toThrow(/Manifestet er ugyldigt: widgets\.0\.kind/);
  });
  test("a widget without an id is an invalid manifest", () => {
    const { id: _id, ...noId } = w;
    expect(() => build({ ...manifest, widgets: [noId] })).toThrow(/Manifestet er ugyldigt: widgets\.0\.id/);
  });
  test("a declared widget without a handler does not start", () => {
    expect(() => build({ ...manifest, widgets: [w] })).toThrow(new ModuleStartError("Mangler handler til widget: noter"));
  });
  test("a handler for a widget the manifest does not declare does not start", () => {
    expect(() => build({ ...manifest, widgets: [] }, { snyd: async () => ({ content: {} }) })).toThrow(new ModuleStartError("Widget står ikke i manifestet: snyd"));
  });
  test("a duplicate id or a permission the module does not hold does not start", () => {
    const h = { noter: async () => ({ content: {} }) };
    expect(() => build({ ...manifest, widgets: [w, w] }, h)).toThrow(/står der to gange/);
    expect(() => build({ ...manifest, widgets: [{ ...w, permission: "patient:read" }] }, h)).toThrow(/kræver patient:read, som ikke står i permissions/);
  });
  test("fysio-work check finds the same problems", () => {
    expect(checkManifest("m.json", JSON.stringify({ ...manifest, widgets: [w, w] })).map((f) => f.message)).toEqual(["Manifestet er ugyldigt: widget «noter» står der to gange"]);
    expect(checkManifest("m.json", JSON.stringify(manifest))).toEqual([]);
  });
});
