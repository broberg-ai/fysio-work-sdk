import { describe, expect, test } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/generate.mjs";
import { contracts as c } from "../src/index";

const root = fileURLToPath(new URL("..", import.meta.url));
const specDir = join(root, "spec");
const gen = generate as (dir: string) => Record<string, string>;

describe("specs -> generated TS (drift guard)", () => {
  test("every generated file on disk is exactly what the specs generate now", () => {
    const fresh = gen(specDir);
    expect(Object.keys(fresh).sort()).toEqual(["src/generated/contracts.ts", "src/generated/core-client.ts"]);
    for (const [rel, text] of Object.entries(fresh)) {
      // Strict equality: a changed spec without `npm run generate` fails here.
      expect(readFileSync(join(root, rel), "utf8"), `${rel} is stale — run npm run generate`).toBe(text);
    }
  });

  test("a changed spec produces different output (the guard can see a change)", () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-"));
    cpSync(specDir, dir, { recursive: true });
    const p = join(dir, "core.openapi.json");
    const spec = JSON.parse(readFileSync(p, "utf8"));
    spec.components.schemas.EventAccepted.properties.queuedAt = { type: "string", format: "date-time" };
    writeFileSync(p, JSON.stringify(spec));
    expect(gen(dir)["src/generated/contracts.ts"]).not.toBe(gen(specDir)["src/generated/contracts.ts"]);
  });

  test.each([
    ["an unknown JSON Schema keyword", (s: any) => (s.components.schemas.EventAccepted.oneOf = [])],
    ["additionalProperties:false (strictness is by direction)", (s: any) => (s.components.schemas.EventAccepted.additionalProperties = false)],
    ["a core operation without x-fysio-permission", (s: any) => delete s.paths["/v1/events"].post["x-fysio-permission"]],
    ["an x-fysio-permission that is not <resource>:<action>", (s: any) => (s.paths["/v1/events"].post["x-fysio-permission"] = "Events")],
    ["a duplicate schema name across specs", (s: any) => (s.components.schemas.PatientRef = { type: "object", properties: {} })],
  ])("the generator refuses %s instead of dropping it", (_name, mutate) => {
    const dir = mkdtempSync(join(tmpdir(), "spec-"));
    cpSync(specDir, dir, { recursive: true });
    const p = join(dir, "core.openapi.json");
    const spec = JSON.parse(readFileSync(p, "utf8"));
    mutate(spec);
    writeFileSync(p, JSON.stringify(spec));
    expect(() => gen(dir)).toThrow();
  });
});

test("every core operation carries the permission the spec names", () => {
  const spec = JSON.parse(readFileSync(join(specDir, "core.openapi.json"), "utf8"));
  const fromSpec = Object.values(spec.paths).flatMap((item: any) =>
    Object.values(item).map((op: any) => [op.operationId, op["x-fysio-permission"]]),
  );
  expect(Object.fromEntries(Object.entries(c.CORE_OPERATIONS).map(([id, op]) => [id, op.permission]))).toEqual(Object.fromEntries(fromSpec));
  expect(c.CORE_OPERATIONS.publishEvent.permission).toBe("events:publish");
});

describe("strict on input, tolerant on responses", () => {
  test("Strict schemas reject an unknown field, at the top and nested", () => {
    expect(c.AuditEntryRequestStrict.safeParse({ action: "x.y", outcome: "confirmed", extra: 1 }).success).toBe(false);
    expect(c.ManifestStrict.safeParse({ ...validManifest(), config: { required: [], extra: true } }).success).toBe(false);
  });

  test("Tolerant schemas accept and drop an unknown field", () => {
    const r = c.AuditEntryReceiptTolerant.parse({ entryId: "e1", recordedAt: "2026-11-05T10:00:00Z", newField: 1 });
    expect(r).toEqual({ entryId: "e1", recordedAt: "2026-11-05T10:00:00Z" });
  });

  test("runtime constants come from spec/runtime.json", () => {
    const runtime = JSON.parse(readFileSync(join(specDir, "runtime.json"), "utf8"));
    expect(c.RUNTIME.headers).toEqual(runtime.headers);
    expect(c.RUNTIME.shutdownGraceSeconds).toBe(runtime.shutdownGraceSeconds);
  });
});

export function validManifest() {
  return {
    manifestVersion: 1,
    id: "hello",
    name: "Hej",
    permissions: ["notes:write"],
    patientDataTables: ["notes"],
    egress: ["api.example.eu"],
    config: { required: [] },
  };
}
