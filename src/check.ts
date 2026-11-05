// `check` v0 — one rule from plan F006 §3.1: a module is started with createModule, never
// with its own server. Developer help, not a security boundary: a module that goes around
// createModule gets no more access, it just gets none. The full `check` is a phase 3 story.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CheckFinding {
  rule: "own-server" | "no-create-module";
  file?: string;
  line?: number;
  message: string;
}

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
      for (const [re, what] of OWN_SERVER) {
        if (re.test(text))
          findings.push({
            rule: "own-server",
            file: f.path,
            line: i + 1,
            message: `Modulet starter sin egen server (${what}). Start det med createModule.`,
          });
      }
    });
  }
  if (!files.some((f) => CREATE_MODULE.test(f.content)))
    findings.push({ rule: "no-create-module", message: "Modulet kalder ikke createModule." });
  return findings;
}

export function checkModuleDir(root: string): CheckFinding[] {
  const files: { path: string; content: string }[] = [];
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
  return checkSources(files);
}
