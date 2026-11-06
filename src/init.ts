// `fysio-work init <folder>` — a new module from templates/module (plan F006 §11 fase 3 trin 4).
// The template is a working module in its own right: the SDK's test suite runs its test and
// `check` against it, so what a developer gets is what was proven.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE } from "./check";

// One level up from both src/init.ts and dist/cli.js.
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TEMPLATE_DIR = join(PACKAGE_ROOT, "templates", "module");
const MODULE_ID = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export interface InitOptions {
  /** Module id (default: the folder name). */
  id?: string;
  /** Module name shown in the clinic (default: the id). */
  name?: string;
}

export class InitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitError";
  }
}

export function sdkVersion(): string {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

export function initModule(target: string, options: InitOptions = {}): { dir: string; id: string } {
  const dir = resolve(target);
  const id = options.id ?? basename(dir);
  if (!MODULE_ID.test(id))
    throw new InitError(
      `«${id}» kan ikke bruges som modul-id: 3–40 tegn, små bogstaver, tal og bindestreg, starter med et bogstav. Brug --id.`,
    );
  if (existsSync(dir) && readdirSync(dir).length) throw new InitError(`Mappen ${dir} findes allerede og er ikke tom.`);
  mkdirSync(dir, { recursive: true });
  cpSync(TEMPLATE_DIR, dir, { recursive: true });
  // npm drops .gitignore from published packages, so the template ships it without the dot.
  renameSync(join(dir, "gitignore"), join(dir, ".gitignore"));

  const json = (file: string, edit: (v: Record<string, any>) => void) => {
    const p = join(dir, file);
    const v = JSON.parse(readFileSync(p, "utf8"));
    edit(v);
    writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
  };
  json(MANIFEST_FILE, (m) => {
    m.id = id;
    m.name = options.name ?? id;
  });
  json("package.json", (p) => {
    p.name = id;
    p.dependencies["@fysio-work/sdk"] = sdkVersion();
  });
  return { dir, id };
}
