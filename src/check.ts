// `check` — deterministic rules from plan F006 §3.1, §3.10 and §11 fase 3 trin 4. Developer
// help, not a security boundary: a module that goes around createModule gets no more access,
// it just gets none, and external databases are also unreachable from the network (§6.1).
// Every finding has a rule id; findings that sit in a file also have file and line.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ManifestStrict } from "./generated/contracts";

export type CheckRule =
  | "own-server"
  | "no-create-module"
  | "external-database"
  | "manifest-missing"
  | "manifest-invalid";

export interface CheckFinding {
  rule: CheckRule;
  file?: string;
  line?: number;
  message: string;
}

/** The manifest file at the root of every module. */
export const MANIFEST_FILE = "fysio-work.manifest.json";

const OWN_SERVER: [RegExp, string][] = [
  [/\bBun\.serve\s*\(/, "Bun.serve"],
  [/\bDeno\.serve\s*\(/, "Deno.serve"],
  [/\bcreateServer\s*\(/, "createServer"],
  [/["']@hono\/node-server["']/, "@hono/node-server"],
  [/\.listen\s*\(/, ".listen()"],
  [/export\s+default\s*\{[^}]*\bfetch\b/, "export default { fetch } (Bun auto-serve)"],
];

// Hosted databases outside the platform (Christian 5/11, valg A: refused for every module —
// a module's data lives in the storage core provisions in the EU, so export and delete work).
const EXTERNAL_DB_PACKAGE =
  /^(?:@supabase\/[^/]+|supabase|firebase|firebase-admin|@firebase\/[^/]+|mongodb|mongoose|@planetscale\/database|@neondatabase\/serverless|@libsql\/client|@vercel\/postgres|@upstash\/redis)(?:\/.*)?$/;
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/g;
const EXTERNAL_DB_HOST = /\b[a-z0-9-]+\.(supabase\.co|supabase\.in|firebaseio\.com|mongodb\.net|neon\.tech|turso\.io)\b/;

const CREATE_MODULE = /\bcreateModule\s*\(/;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

const externalDb = (what: string) =>
  `Modulet bruger en ekstern database (${what}). Modulets data skal bo i platformens lager i EU, så eksport og sletning altid virker.`;

export function checkSources(files: { path: string; content: string }[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const f of files) {
    f.content.split("\n").forEach((text, i) => {
      const at = { file: f.path, line: i + 1 };
      for (const [re, what] of OWN_SERVER) {
        if (re.test(text))
          findings.push({ rule: "own-server", ...at, message: `Modulet starter sin egen server (${what}). Start det med createModule.` });
      }
      for (const m of text.matchAll(IMPORT_SPECIFIER)) {
        if (EXTERNAL_DB_PACKAGE.test(m[1])) findings.push({ rule: "external-database", ...at, message: externalDb(m[1]) });
      }
      const host = EXTERNAL_DB_HOST.exec(text);
      if (host) findings.push({ rule: "external-database", ...at, message: externalDb(host[0]) });
    });
  }
  if (!files.some((f) => CREATE_MODULE.test(f.content)))
    findings.push({ rule: "no-create-module", message: "Modulet kalder ikke createModule." });
  return findings;
}

/** package.json: an external database client among the dependencies is refused too. */
export function checkPackageJson(path: string, content: string): CheckFinding[] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const findings: CheckFinding[] = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys((pkg[field] as Record<string, string> | undefined) ?? {})) {
      if (!EXTERNAL_DB_PACKAGE.test(name)) continue;
      const line = lines.findIndex((l) => l.includes(`"${name}"`)) + 1;
      findings.push({ rule: "external-database", file: path, line: line || 1, message: externalDb(name) });
    }
  }
  return findings;
}

/** The manifest file, validated against spec/manifest.schema.json (strict: unknown field = error). */
export function checkManifest(path: string, content: string | undefined): CheckFinding[] {
  if (content === undefined)
    return [{ rule: "manifest-missing", message: `Modulet mangler ${MANIFEST_FILE} i roden.` }];
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return [{ rule: "manifest-invalid", file: path, line: 1, message: `${MANIFEST_FILE} er ikke gyldig JSON.` }];
  }
  const r = ManifestStrict.safeParse(raw);
  if (r.success) return [];
  const lines = content.split("\n");
  return r.error.issues.map((issue) => {
    const keys = issue.code === "unrecognized_keys" ? [...issue.path, ...issue.keys] : issue.path;
    const top = keys.find((k): k is string => typeof k === "string");
    const line = top ? lines.findIndex((l) => l.includes(`"${top}"`)) + 1 : 0;
    const where = keys.join(".") || "(manifest)";
    return {
      rule: "manifest-invalid" as const,
      file: path,
      line: line || 1,
      message: `Manifestet er ugyldigt ved ${where}: ${issue.message}`,
    };
  });
}

export function checkModuleDir(root: string): CheckFinding[] {
  const files: { path: string; content: string }[] = [];
  const findings: CheckFinding[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else if (SOURCE.test(name)) {
        files.push({ path: relative(root, full), content: readFileSync(full, "utf8") });
      } else if (name === "package.json") {
        findings.push(...checkPackageJson(relative(root, full), readFileSync(full, "utf8")));
      }
    }
  };
  walk(root);
  const manifestPath = join(root, MANIFEST_FILE);
  findings.push(...checkManifest(MANIFEST_FILE, existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : undefined));
  return [...findings, ...checkSources(files)];
}
