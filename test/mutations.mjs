// Mutation guard: each mutation must turn the test suite red.
// A test that stays green when the code under it is broken proves nothing.
// `regenerate: true` re-runs the generator after mutating it, so the drift test cannot be
// what catches the mutation — the behaviour tests must.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const at = (p) => new URL(`../${p}`, import.meta.url);
const regen = () => execSync("node scripts/generate.mjs", { stdio: "ignore", cwd: new URL("..", import.meta.url) });

const mutations = [
  // spec -> generated
  { name: "spec changed without regenerating", file: "spec/core.openapi.json",
    mutate: (s) => s.replace('"eventId": { "type": "string" }', '"eventId": { "type": "string" }, "queuedAt": { "type": "string" }') },
  { name: "requests generated tolerant instead of strict", file: "scripts/generate.mjs", regenerate: true,
    mutate: (s) => s.replace('mode === "strict" ? "z.strictObject" : "z.object"', '"z.object"') },
  { name: "responses generated strict instead of tolerant", file: "scripts/generate.mjs", regenerate: true,
    mutate: (s) => s.replace('mode === "strict" ? "z.strictObject" : "z.object"', '"z.strictObject"') },
  { name: "generator ignores unknown keywords", file: "scripts/generate.mjs", regenerate: true,
    mutate: (s) => s.replace("throw new Error(`${where}: unsupported keyword", "void (`${where}: unsupported keyword") },
  { name: "generator does not require x-fysio-permission", file: "scripts/generate.mjs", regenerate: true,
    mutate: (s) => s.replace("if (typeof permission !== \"string\" || !new RegExp(permissionPattern).test(permission))", "if (false)") },
  { name: "permission not generated into CORE_OPERATIONS", file: "scripts/generate.mjs", regenerate: true,
    mutate: (s) => s.replace("${o.permission ? `, permission: ${JSON.stringify(o.permission)}` : \"\"}", "") },
  { name: "spec says clinic again", file: "spec/module.openapi.json", regenerate: true,
    mutate: (s) => s.replace("one patient in one organization (§3.10).", "one patient in one clinic (§3.10).") },
  // core client
  { name: "client does not check the request before sending", file: "src/core-call.ts",
    mutate: (s) => s.replace("const payload = requestSchema.parse(body);", "const payload = body;") },
  { name: "client does not forward the trace id", file: "src/core-call.ts",
    mutate: (s) => s.replace("[h.traceId]: ctx.traceId,", "") },
  // createModule
  { name: "ticket check skipped when no ticket", file: "src/module.ts",
    mutate: (s) => s.replace('if (!bearer) return fail(c, 401, "missing_ticket"', 'if (false) return fail(c, 401, "missing_ticket"') },
  { name: "ticket verifier failure ignored", file: "src/module.ts",
    mutate: (s) => s.replace('return fail(c, 401, "invalid_ticket", "Billetten er ugyldig eller udløbet.");', // the forged principal carries claims that would pass every later check
      'principal = { subject: "anon", claims: { iss: options.tickets.issuer, aud: MODULE_AUDIENCE_PREFIX + manifest.id, org: c.req.header(H.organizationId), data_scope: "organization" } };') },
  { name: "header organization not checked against the ticket's org", file: "src/module.ts",
    mutate: (s) => s.replace("if (claims.org !== organizationId) return", "if (false) return") },
  { name: "module starts without a ticket issuer", file: "src/module.ts",
    mutate: (s) => s.replace("if (!options.tickets.issuer) throw", "if (false) throw") },
  { name: "ticket issuer not checked", file: "src/module.ts",
    mutate: (s) => s.replace("claims.iss !== options.tickets.issuer || ", "") },
  { name: "ticket audience not checked", file: "src/module.ts",
    mutate: (s) => s.replace(" || claims.aud !== MODULE_AUDIENCE_PREFIX + manifest.id", "") },
  { name: "audience checked by prefix only", file: "src/module.ts",
    mutate: (s) => s.replace("claims.aud !== MODULE_AUDIENCE_PREFIX + manifest.id", '!String(claims.aud).startsWith(MODULE_AUDIENCE_PREFIX + manifest.id)') },
  { name: "data_scope none let through", file: "src/module.ts",
    mutate: (s) => s.replace('if (claims.data_scope !== "organization" && claims.data_scope !== "self") {', "if (false) {") },
  { name: "organization context not required", file: "src/module.ts",
    mutate: (s) => s.replace("if (!organizationId || !organizationTicket) return", "if (false) return") },
  { name: "trace id not echoed", file: "src/module.ts",
    mutate: (s) => s.replace("c.header(H.traceId, traceId);", "") },
  { name: "GDPR endpoints open to any ticket", file: "src/module.ts",
    mutate: (s) => s.replace("if (c.var.principal.subject !== RUNTIME.coreSubject) return", "if (false) return") },
  { name: "draining does not refuse new calls", file: "src/module.ts",
    mutate: (s) => s.replace("if (draining) {", "if (false) {") },
  { name: "shutdown does not wait for calls in flight", file: "src/module.ts",
    mutate: (s) => s.replace("if (inflight === 0) return resolve(false);", "return resolve(false);") },
  { name: "missing config ignored", file: "src/module.ts",
    mutate: (s) => s.replace("if (missing.length) throw", "if (false) throw") },
  { name: "error message leaks into the log", file: "src/module.ts",
    mutate: (s) => s.replace("errorName: err.name,", "errorName: err.message,") },
  // strict input
  { name: "stripped keys not detected", file: "src/strict.ts",
    mutate: (s) => s.replace("return k in output ? strippedKeys(input[k], output[k], p) : [p];", "return [];") },
  // logging
  { name: "log allowlist disabled", file: "src/log.ts",
    mutate: (s) => s.replace("if (!allowed.has(key) || !isLogValue(value)) {", "if (!isLogValue(value)) {") },
  { name: "CPR filter disabled", file: "src/log.ts",
    mutate: (s) => s.replace("value.replace(CPR, REDACTED)", "value") },
  { name: "free-text event names allowed", file: "src/log.ts",
    mutate: (s) => s.replace('EVENT_NAME.test(event) ? event : "invalid_event_name"', "event") },
  // check
  { name: "check misses Bun.serve", file: "src/check.ts",
    mutate: (s) => s.replace('[/\\bBun\\.serve\\s*\\(/, "Bun.serve"],', "") },
  { name: "check does not require createModule", file: "src/check.ts",
    mutate: (s) => s.replace("if (!files.some((f) => CREATE_MODULE.test(f.content)))", "if (false)") },
  { name: "check misses Supabase", file: "src/check.ts",
    mutate: (s) => s.replace("@supabase\\/[^/]+|", "") },
  { name: "check ignores external database hosts", file: "src/check.ts",
    mutate: (s) => s.replace("const host = EXTERNAL_DB_HOST.exec(text);", "const host = null;") },
  { name: "check skips package.json", file: "src/check.ts",
    mutate: (s) => s.replace('} else if (name === "package.json") {', "} else if (false) {") },
  { name: "check does not validate the manifest", file: "src/check.ts",
    mutate: (s) => s.replace("if (r.success) return [];", "if (true) return [];") },
  { name: "check accepts a missing manifest", file: "src/check.ts",
    mutate: (s) => s.replace("if (content === undefined)\n", "if (false)\n") },
  // cli + init
  { name: "cli exits 0 on findings", file: "src/cli-main.ts",
    mutate: (s) => s.replace("return findings.length ? 1 : 0;", "return 0;") },
  { name: "init keeps the template's module id", file: "src/init.ts",
    mutate: (s) => s.replace("m.id = id;", "") },
  { name: "init does not pin this SDK version", file: "src/init.ts",
    mutate: (s) => s.replace('p.dependencies["@fysio-work/sdk"] = sdkVersion();', "") },
  // sandbox + template
  { name: "sandbox accepts tickets it never issued", file: "src/sandbox.ts",
    mutate: (s) => s.replace('if (!p) throw new Error("unknown ticket");', 'if (!p) return { subject: "anon", claims: { iss: baseUrl, aud: "module:hello", org: "demo", data_scope: "organization" } };') },
  { name: "runSandbox does not wire the module to the sandbox core", file: "src/sandbox.ts",
    mutate: (s) => s.replace("core: sandbox.coreFor(() => mod!.manifest.id),", "core: undefined,") },
  { name: "template deletePatient deletes nothing", file: "templates/module/src/module.ts",
    mutate: (s) => s.replace("notes.set(ctx.organization.id, forOrganization(ctx.organization.id).filter((n) => n.patientId !== patientId));", "") },
];

let survived = 0;
for (const { name, file, mutate, regenerate } of mutations) {
  const path = at(file);
  const original = readFileSync(path, "utf8");
  const m = mutate(original);
  if (m === original) {
    console.error(`BROKEN MUTATION: "${name}" did not change ${file}`);
    survived++;
    continue;
  }
  try {
    writeFileSync(path, m);
    if (regenerate) regen();
    try {
      execSync("npx vitest run", { stdio: "ignore" });
      console.error(`SURVIVED: ${name}`);
      survived++;
    } catch {
      console.log(`killed: ${name}`);
    }
  } finally {
    writeFileSync(path, original);
    if (regenerate) regen();
  }
}
if (survived) process.exit(1);
