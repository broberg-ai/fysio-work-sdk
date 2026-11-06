// init -> check -> run against the sandbox, on a freshly generated module.
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkModuleDir } from "../src/index";
import { InitError, initModule, sdkVersion, TEMPLATE_DIR } from "../src/init";
import { main } from "../src/cli-main";
import { runSandbox } from "../src/sandbox";

const tmp = () => mkdtempSync(join(tmpdir(), "fysio-work-init-"));
let stop: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe("the template itself", () => {
  test("passes check", () => {
    expect(checkModuleDir(TEMPLATE_DIR)).toEqual([]);
  });
});

describe("init", () => {
  test("a new module gets its id, name and this SDK version, and passes check", () => {
    const dir = join(tmp(), "klinik-noter");
    const r = initModule(dir, { name: "Klinik-noter" });
    expect(r.id).toBe("klinik-noter");
    const manifest = JSON.parse(readFileSync(join(dir, "fysio-work.manifest.json"), "utf8"));
    expect(manifest.id).toBe("klinik-noter");
    expect(manifest.name).toBe("Klinik-noter");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("klinik-noter");
    expect(pkg.dependencies["@fysio-work/sdk"]).toBe(sdkVersion());
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    for (const f of ["AGENTS.md", "CLAUDE.md", "README.md", ".github/workflows/ci.yml", "src/module.ts", "src/dev.ts", "test/module.test.ts"])
      expect(existsSync(join(dir, f)), f).toBe(true);
    expect(checkModuleDir(dir)).toEqual([]);
  });

  test("the generated module runs against the sandbox: 200 with a ticket, 401 without, its core call lands", async () => {
    const dir = join(tmp(), "klinik-noter");
    initModule(dir);
    const { buildModule } = await import(pathToFileURL(join(dir, "src/module.ts")).href);
    const printed: string[] = [];
    const dev = await runSandbox((deps) => buildModule({ ...deps, log: { sink: () => {} } }), {
      port: 0,
      hostname: "127.0.0.1",
      handleSignals: false,
      print: (t) => printed.push(t),
    });
    stop = dev.stop;
    expect(dev.module.manifest.id).toBe("klinik-noter");

    const [health, withTicket, withoutTicket, gdpr] = dev.examples;
    const call = (e: typeof health) =>
      fetch(e.url, { method: e.method, headers: e.headers, body: e.body === undefined ? undefined : JSON.stringify(e.body) });
    expect((await call(health)).status).toBe(200);
    expect((await call(withTicket)).status).toBe(200);
    expect((await call(withoutTicket)).status).toBe(401);
    expect(await (await call(gdpr)).json()).toEqual({ patientId: "patient-1", data: { notes: [] } });

    const res = await fetch(`${dev.base}/notes`, {
      method: "POST",
      headers: { ...dev.user, "content-type": "application/json" },
      body: JSON.stringify({ patientId: "p1", text: "hej" }),
    });
    expect(res.status).toBe(201);
    expect(dev.sandbox.calls).toEqual([expect.objectContaining({ operation: "appendAuditEntry", ticketSubject: "svc:klinik-noter" })]);
    // The developer is told the core call landed, and every example is printed as a curl line.
    expect(printed.join("\n")).toContain("sandkasse-core: appendAuditEntry fra svc:klinik-noter");
    expect(printed[0]).toContain(`curl -i '${dev.base}/health'`);
    expect(printed[0]).toContain(`-H 'authorization: ${dev.user.authorization}'`);
  });

  test("a module with an external database, made from the template, is refused", () => {
    const dir = join(tmp(), "klinik-noter");
    initModule(dir);
    const p = join(dir, "src/module.ts");
    writeFileSync(p, `import { createClient } from "@supabase/supabase-js";\n${readFileSync(p, "utf8")}`);
    expect(checkModuleDir(dir).map((f) => f.rule)).toEqual(["external-database"]);
  });

  test("an external database added to the module's package.json is refused", () => {
    const dir = join(tmp(), "klinik-noter");
    initModule(dir);
    const p = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    pkg.dependencies["@supabase/supabase-js"] = "^2.0.0";
    writeFileSync(p, JSON.stringify(pkg, null, 2));
    expect(checkModuleDir(dir)).toEqual([
      { rule: "external-database", file: "package.json", line: expect.any(Number), message: expect.stringContaining("@supabase/supabase-js") },
    ]);
  });

  test("refuses a folder that is not empty, and an id the platform cannot use", () => {
    const dir = tmp();
    mkdirSync(join(dir, "x-y-z"));
    writeFileSync(join(dir, "x-y-z", "a.txt"), "a");
    expect(() => initModule(join(dir, "x-y-z"))).toThrow(InitError);
    expect(() => initModule(join(dir, "Mit Modul"))).toThrow(/kan ikke bruges som modul-id/);
  });
});

describe("cli", () => {
  const run = (argv: string[], cwd?: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, { out: (t) => out.push(t), err: (t) => err.push(t), cwd });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };

  test("init then check is green, exit 0", () => {
    const cwd = tmp();
    const init = run(["init", join(cwd, "mit-modul")], cwd);
    expect(init.code).toBe(0);
    expect(init.out).toContain("cd mit-modul");
    expect(run(["check", join(cwd, "mit-modul")])).toEqual({ code: 0, out: "check: ingen fund.", err: "" });
  });

  test("check with findings exits non-zero, with rule id, file and line; --json for CI", () => {
    const cwd = tmp();
    run(["init", join(cwd, "mit-modul")], cwd);
    writeFileSync(join(cwd, "mit-modul", "src", "server.ts"), "Bun.serve({ fetch() { return new Response(); } });\n");
    const human = run(["check", join(cwd, "mit-modul")]);
    expect(human.code).toBe(1);
    expect(human.err).toContain("own-server src/server.ts:1");
    const json = run(["check", join(cwd, "mit-modul"), "--json"]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toEqual({
      ok: false,
      findings: [{ rule: "own-server", file: "src/server.ts", line: 1, message: expect.any(String) }],
    });
  });

  test("an unknown command shows usage and exits 2", () => {
    expect(run(["deploy"]).code).toBe(2);
    expect(run(["init"]).code).toBe(2);
  });
});
