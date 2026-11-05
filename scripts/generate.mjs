// Generates src/generated/* from spec/* (plan F006 §3: SDKs are generated from the specs).
//
//   node scripts/generate.mjs          write the files
//   generate(specDir) -> { path: text }  used by the drift test (test/generated.test.ts)
//
// Strictness is decided by DIRECTION, never by the spec: every named schema becomes
// `<Name>Strict` (unknown field -> error; used on everything sent TO core or a module)
// and `<Name>Tolerant` (unknown field ignored; used on responses). A spec that uses a
// JSON Schema keyword this generator does not understand is refused, so nothing in the
// spec can be silently dropped.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ANNOTATIONS = new Set(["description", "title", "$comment", "examples"]);
const KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "$ref",
]);
const FORMATS = { "date-time": "z.iso.datetime()", uri: "z.url()" };

function refName(ref) {
  const m = /^#\/(?:components\/schemas|\$defs)\/([A-Za-z][A-Za-z0-9]*)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref ${ref} (only local #/components/schemas/X or #/$defs/X)`);
  return m[1];
}

function zodFor(schema, mode, where) {
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k) && !k.startsWith("$schema") && k !== "$id")
      throw new Error(`${where}: unsupported keyword "${k}"`);
  }
  if (schema.$ref) return `${refName(schema.$ref)}${mode === "strict" ? "Strict" : "Tolerant"}`;
  if ("const" in schema) return `z.literal(${JSON.stringify(schema.const)})`;
  if (schema.enum) {
    if (!schema.enum.every((v) => typeof v === "string")) throw new Error(`${where}: only string enums`);
    return `z.enum(${JSON.stringify(schema.enum)})`;
  }
  switch (schema.type) {
    case "string": {
      if (schema.format && !FORMATS[schema.format]) throw new Error(`${where}: unsupported format ${schema.format}`);
      let s = schema.format ? FORMATS[schema.format] : "z.string()";
      if (schema.minLength !== undefined) s += `.min(${schema.minLength})`;
      if (schema.maxLength !== undefined) s += `.max(${schema.maxLength})`;
      if (schema.pattern) s += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`;
      return s;
    }
    case "integer":
    case "number": {
      let s = schema.type === "integer" ? "z.number().int()" : "z.number()";
      if (schema.minimum !== undefined) s += `.min(${schema.minimum})`;
      if (schema.maximum !== undefined) s += `.max(${schema.maximum})`;
      return s;
    }
    case "boolean":
      return "z.boolean()";
    case "array": {
      if (!schema.items) throw new Error(`${where}: array without items`);
      let s = `z.array(${zodFor(schema.items, mode, `${where}[]`)})`;
      if (schema.minItems !== undefined) s += `.min(${schema.minItems})`;
      if (schema.maxItems !== undefined) s += `.max(${schema.maxItems})`;
      return s;
    }
    case "object": {
      if (schema.additionalProperties === true && !schema.properties) return "z.record(z.string(), z.unknown())";
      if ("additionalProperties" in schema)
        throw new Error(`${where}: additionalProperties is decided by direction (strict/tolerant), not by the spec`);
      const required = new Set(schema.required ?? []);
      const props = Object.entries(schema.properties ?? {}).map(([name, sub]) => {
        const z = zodFor(sub, mode, `${where}.${name}`);
        return `  ${JSON.stringify(name)}: ${z}${required.has(name) ? "" : ".optional()"},`;
      });
      for (const r of required) if (!(r in (schema.properties ?? {}))) throw new Error(`${where}: required "${r}" is not a property`);
      const ctor = mode === "strict" ? "z.strictObject" : "z.object";
      return `${ctor}({\n${props.join("\n")}\n})`;
    }
    default:
      throw new Error(`${where}: unsupported or missing type ${JSON.stringify(schema.type)}`);
  }
}

function collectRefs(schema, out = new Set()) {
  if (schema && typeof schema === "object") {
    if (typeof schema.$ref === "string") out.add(refName(schema.$ref));
    for (const v of Object.values(schema)) collectRefs(v, out);
  }
  return out;
}

/** Emit named schemas in dependency order, each as a Strict and a Tolerant variant. */
function emitSchemas(named, source) {
  const out = [];
  const done = new Set();
  const visit = (name, stack = []) => {
    if (done.has(name)) return;
    if (stack.includes(name)) throw new Error(`${source}: recursive schema ${name} is not supported`);
    if (!named[name]) throw new Error(`${source}: $ref to missing schema ${name}`);
    for (const dep of collectRefs(named[name])) visit(dep, [...stack, name]);
    done.add(name);
    const doc = named[name].description ? `/** ${named[name].description.replace(/\*\//g, "* /")} */\n` : "";
    out.push(
      `// ${source} · ${name}\n` +
        `${doc}export const ${name}Strict = ${zodFor(named[name], "strict", name)};\n` +
        `export const ${name}Tolerant = ${zodFor(named[name], "tolerant", name)};\n` +
        `export type ${name} = z.infer<typeof ${name}Strict>;\n`,
    );
  };
  for (const name of Object.keys(named).sort()) visit(name);
  return out;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function operations(api, source) {
  const ops = [];
  for (const [path, item] of Object.entries(api.paths ?? {})) {
    if (/[{}]/.test(path)) throw new Error(`${source}: path parameters are not supported yet (${path})`);
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method)) throw new Error(`${source}: unsupported ${method} on ${path}`);
      if (!op.operationId) throw new Error(`${source}: ${method.toUpperCase()} ${path} has no operationId`);
      const reqRef = op.requestBody?.content?.["application/json"]?.schema?.$ref;
      const success = Object.entries(op.responses ?? {}).filter(([code]) => /^2\d\d$/.test(code));
      if (success.length !== 1) throw new Error(`${source}: ${op.operationId} must have exactly one 2xx response`);
      const [status, res] = success[0];
      const resRef = res.content?.["application/json"]?.schema?.$ref;
      if (!resRef) throw new Error(`${source}: ${op.operationId} 2xx response needs a JSON schema $ref`);
      ops.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        status: Number(status),
        request: reqRef ? refName(reqRef) : null,
        response: refName(resRef),
      });
    }
  }
  return ops.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every spec shares one generated namespace, so a name may exist in only one spec. */
function uniqueNames(sources) {
  const seen = new Map();
  for (const [file, named] of sources)
    for (const name of Object.keys(named)) {
      if (seen.has(name)) throw new Error(`schema ${name} is defined in both ${seen.get(name)} and ${file}`);
      seen.set(name, file);
    }
  return [];
}

const HEADER =
  "// GENERATED by scripts/generate.mjs from spec/* — do not edit by hand.\n" +
  "// Change the spec, run `npm run generate`; test/generated.test.ts fails if you forget.\n";

export function generate(specDir) {
  const read = (f) => JSON.parse(readFileSync(join(specDir, f), "utf8"));
  const runtime = read("runtime.json");
  const manifest = read("manifest.schema.json");
  const moduleApi = read("module.openapi.json");
  const coreApi = read("core.openapi.json");
  const events = read("events.asyncapi.json");

  const { $schema, $id, title, ...manifestBody } = manifest;
  if (title !== "Manifest") throw new Error("manifest.schema.json: title must be Manifest");

  const moduleOps = operations(moduleApi, "module.openapi.json");
  const coreOps = operations(coreApi, "core.openapi.json");
  const opTable = (ops) =>
    `{\n${ops
      .map((o) => `  ${o.id}: { method: ${JSON.stringify(o.method)}, path: ${JSON.stringify(o.path)}, status: ${o.status} },`)
      .join("\n")}\n} as const`;

  const contracts = [
    HEADER,
    `import { z } from "zod";\n`,
    `/** Runtime contract (spec/runtime.json). */\nexport const RUNTIME = ${JSON.stringify(runtime, null, 2).replace(/^\{\n  "\$comment": .*\n/, "{\n")} as const;\n`,
    `/** Spec versions this SDK was generated from. */\nexport const SPEC_VERSIONS = ${JSON.stringify(
      { runtime: runtime.version, module: moduleApi.info.version, core: coreApi.info.version, events: events.info.version },
      null,
      2,
    )} as const;\n`,
    ...uniqueNames([["manifest.schema.json", { Manifest: manifestBody }], ["module.openapi.json", moduleApi.components.schemas], ["core.openapi.json", coreApi.components.schemas], ["events.asyncapi.json", events.components.schemas]]),
    ...emitSchemas({ Manifest: manifestBody }, "manifest.schema.json"),
    ...emitSchemas(moduleApi.components.schemas, "module.openapi.json"),
    ...emitSchemas(coreApi.components.schemas, "core.openapi.json"),
    ...emitSchemas(events.components.schemas, "events.asyncapi.json"),
    `/** Endpoints createModule serves (spec/module.openapi.json). */\nexport const MODULE_OPERATIONS = ${opTable(moduleOps)};\n`,
    `/** Endpoints core serves (spec/core.openapi.json). */\nexport const CORE_OPERATIONS = ${opTable(coreOps)};\n`,
  ].join("\n");

  const methods = coreOps.map((o) => {
    if (!o.request) throw new Error(`core.openapi.json: ${o.id} needs a request body (GET without body not supported yet)`);
    return (
      `    ${o.id}: (body: c.${o.request}) =>\n` +
      `      call(options, CORE_OPERATIONS.${o.id}, "${o.id}", c.${o.request}Strict, c.${o.response}Tolerant, body),`
    );
  });
  const client = [
    HEADER,
    `import * as c from "./contracts";`,
    `import { CORE_OPERATIONS } from "./contracts";`,
    `import { call, type CoreClientOptions } from "../core-call";\n`,
    `/** Typed client for core (spec/core.openapi.json). Requests are checked strictly before they leave; responses are read tolerantly. */`,
    `export function createCoreClient(options: CoreClientOptions) {`,
    `  return {`,
    ...methods,
    `  };`,
    `}\n`,
    `export type CoreClient = ReturnType<typeof createCoreClient>;\n`,
  ].join("\n");

  return { "src/generated/contracts.ts": contracts, "src/generated/core-client.ts": client };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [rel, text] of Object.entries(generate(join(root, "spec")))) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
    console.log(`wrote ${rel}`);
  }
}
