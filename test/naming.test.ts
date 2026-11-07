// The tenant is an ORGANIZATION (owner decision 7/11 2026: «Omdøb til organization»).
// No contract key, header, error code, event field or exported name may say "clinic".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as sdk from "../src/index";
import * as sandbox from "../src/sandbox";

const root = new URL("..", import.meta.url).pathname;
const CLINIC = /clinic/i;

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function grep(dir: string): string[] {
  return files(dir).flatMap((f) =>
    readFileSync(join(root, f), "utf8")
      .split("\n")
      .flatMap((l, i) => (CLINIC.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : [])),
  );
}

/** Every key and string value reachable from an export, with its path. */
function names(value: unknown, path: string, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [`${path} = ${value}`];
  if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return [];
  seen.add(value);
  if (typeof value === "function") return [path];
  return Object.entries(value).flatMap(([k, v]) => [`${path}.${k}`, ...names(v, `${path}.${k}`, seen)]);
}

describe("no 'clinic' in the contract or the public API", () => {
  test("spec/ never says clinic", () => {
    expect(grep("spec")).toEqual([]);
  });

  test("src/ (exported names, types, members, error codes) never says clinic", () => {
    expect(grep("src")).toEqual([]);
  });

  test("no runtime export, key or contract value says clinic", () => {
    const { z: _zod, ...ours } = sdk;
    const all = [...names(ours, "sdk"), ...names(sandbox, "sandbox")];
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((n) => CLINIC.test(n))).toEqual([]);
  });
});
