import { describe, expect, test } from "vitest";
import { checkManifest, checkSources } from "../src/index";

const withModule = (extra: string) => [
  { path: "src/main.ts", content: `import { createModule } from "@fysio-work/sdk";\nconst m = createModule({});\n${extra}` },
];

describe("check: a module starts through createModule, never its own server", () => {
  test("a module that only uses createModule has no findings", () => {
    expect(checkSources(withModule("await m.start();"))).toEqual([]);
  });

  test.each([
    ["Bun.serve", "Bun.serve({ fetch: app.fetch });"],
    ["Deno.serve", "Deno.serve(app.fetch);"],
    ["createServer", "http.createServer(handler);"],
    ["@hono/node-server", 'import { serve } from "@hono/node-server";'],
    [".listen()", "app.listen(3000);"],
    ["export default { fetch }", "export default { port: 3000, fetch: app.fetch };"],
  ])("%s is refused with file and line", (_what, line) => {
    const f = checkSources(withModule(line));
    expect(f).toEqual([{ rule: "own-server", file: "src/main.ts", line: 3, message: expect.stringContaining("createModule") }]);
  });

  test("a module that never calls createModule is refused", () => {
    expect(checkSources([{ path: "a.ts", content: "export const x = 1;" }])).toEqual([
      { rule: "no-create-module", message: "Modulet kalder ikke createModule." },
    ]);
  });
});

describe("check: the module's database is not checked (Christian 10/11, D-cf63a6)", () => {
  test("Supabase imports and hosts give no findings", () => {
    const lines = 'import { createClient } from "@supabase/supabase-js";\nconst url = "https://abcd1234.supabase.co";';
    expect(checkSources(withModule(lines))).toEqual([]);
  });
});

describe("check: the manifest file", () => {
  const valid = {
    manifestVersion: 1,
    id: "mit-modul",
    name: "Mit modul",
    permissions: [],
    patientDataTables: [],
    egress: [],
    config: { required: [] },
  };
  const file = (v: unknown) => JSON.stringify(v, null, 2);

  test("a valid manifest has no findings", () => {
    expect(checkManifest("fysio-work.manifest.json", file(valid))).toEqual([]);
  });
  test("a missing manifest is refused", () => {
    expect(checkManifest("fysio-work.manifest.json", undefined)).toEqual([
      { rule: "manifest-missing", message: expect.stringContaining("fysio-work.manifest.json") },
    ]);
  });
  test("a manifest that is not JSON is refused", () => {
    expect(checkManifest("fysio-work.manifest.json", "{ id: x")).toEqual([
      { rule: "manifest-invalid", file: "fysio-work.manifest.json", line: 1, message: expect.stringContaining("JSON") },
    ]);
  });
  test("an invalid field is refused with the line it sits on", () => {
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, id: "Bad Id" }))).toEqual([
      { rule: "manifest-invalid", file: "fysio-work.manifest.json", line: 3, message: expect.stringContaining("ved id") },
    ]);
  });
  test("pricing: free and paid are valid, anything else is refused", () => {
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, pricing: "free" }))).toEqual([]);
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, pricing: "paid" }))).toEqual([]);
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, pricing: "gratis" }))).toEqual([
      { rule: "manifest-invalid", file: "fysio-work.manifest.json", line: 11, message: expect.stringContaining("ved pricing") },
    ]);
  });
  test("an unknown field is refused, never ignored", () => {
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, version: "1.0.0" }))).toEqual([
      { rule: "manifest-invalid", file: "fysio-work.manifest.json", line: 11, message: expect.stringContaining("ved version") },
    ]);
  });
});
