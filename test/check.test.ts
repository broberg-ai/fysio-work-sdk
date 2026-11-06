import { describe, expect, test } from "vitest";
import { checkManifest, checkSources } from "../src/index";
import { checkPackageJson } from "../src/check";

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

describe("check: no external databases (Christian 5/11, valg A)", () => {
  test.each([
    ['import { createClient } from "@supabase/supabase-js";'],
    ['const { createClient } = require("@supabase/supabase-js");'],
    ['const s = await import("@supabase/supabase-js");'],
    ['import "@supabase/auth-helpers-nextjs";'],
    ['import { initializeApp } from "firebase/app";'],
    ['import admin from "firebase-admin";'],
    ['import { MongoClient } from "mongodb";'],
    ['import mongoose from "mongoose";'],
    ['import { neon } from "@neondatabase/serverless";'],
    ['import { connect } from "@planetscale/database";'],
    ['import { createClient } from "@libsql/client";'],
    ['import { sql } from "@vercel/postgres";'],
    ['import { Redis } from "@upstash/redis";'],
    ['const url = "https://abcd1234.supabase.co";'],
  ])("%s is refused with file and line", (line) => {
    expect(checkSources(withModule(line))).toEqual([
      { rule: "external-database", file: "src/main.ts", line: 3, message: expect.stringContaining("platformens lager") },
    ]);
  });

  test("a module's own imports and the platform's storage are not refused", () => {
    expect(checkSources(withModule('import { x } from "./supabase-free";\nimport pg from "pg";'))).toEqual([]);
  });

  test("an external database in package.json is refused with its line", () => {
    const pkg = JSON.stringify({ name: "m", dependencies: { hono: "1", "@supabase/supabase-js": "2" } }, null, 2);
    expect(checkPackageJson("package.json", pkg)).toEqual([
      { rule: "external-database", file: "package.json", line: 5, message: expect.stringContaining("@supabase/supabase-js") },
    ]);
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
  test("an unknown field is refused, never ignored", () => {
    expect(checkManifest("fysio-work.manifest.json", file({ ...valid, version: "1.0.0" }))).toEqual([
      { rule: "manifest-invalid", file: "fysio-work.manifest.json", line: 11, message: expect.stringContaining("ved version") },
    ]);
  });
});
