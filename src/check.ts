// `check` — deterministic rules from plan F006 §3.1, §3.10 and §11 fase 3 trin 4. Developer
// help, not a security boundary: a module that goes around createModule gets no more access,
// it just gets none. Which database a module uses is not checked here (Christian 10/11,
// D-cf63a6/D-a204f6: own database in the EU is allowed without patient data).
// Every finding has a rule id; findings that sit in a file also have file and line.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ManifestStrict } from "./generated/contracts";

export type CheckRule =
  | "own-server"
  | "no-create-module"
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

const CREATE_MODULE = /\bcreateModule\s*\(/;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

export function checkSources(files: { path: string; content: string }[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const f of files) {
    f.content.split("\n").forEach((text, i) => {
      const at = { file: f.path, line: i + 1 };
      for (const [re, what] of OWN_SERVER) {
        if (re.test(text))
          findings.push({ rule: "own-server", ...at, message: `Modulet starter sin egen server (${what}). Start det med createModule.` });
      }
    });
  }
  if (!files.some((f) => CREATE_MODULE.test(f.content)))
    findings.push({ rule: "no-create-module", message: "Modulet kalder ikke createModule." });
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
      }
    }
  };
  walk(root);
  const manifestPath = join(root, MANIFEST_FILE);
  findings.push(...checkManifest(MANIFEST_FILE, existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : undefined));
  return [...findings, ...checkSources(files)];
}
