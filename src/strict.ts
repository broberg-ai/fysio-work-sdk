// Strict on input (plan F006 §3): an unknown field in a call to a module is a 400 — never
// silently stripped. Works on ANY Zod schema: whatever the schema would have dropped is
// found by comparing the input with what came out, at every depth.
import type { z } from "zod";

/** Key paths present in `input` but missing from `output` (what a parse stripped). */
export function strippedKeys(input: unknown, output: unknown, path = ""): string[] {
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.flatMap((v, i) => strippedKeys(v, output[i], `${path}[${i}]`));
  }
  if (isPlainObject(input) && isPlainObject(output)) {
    return Object.keys(input).flatMap((k) => {
      const p = path ? `${path}.${k}` : k;
      return k in output ? strippedKeys(input[k], output[k], p) : [p];
    });
  }
  return [];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type StrictResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "invalid_body" | "unknown_field"; fields: string[] };

export function parseStrict<T>(schema: z.ZodType<T>, input: unknown): StrictResult<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields = r.error.issues.flatMap((i) =>
      i.code === "unrecognized_keys" ? i.keys.map((k) => [...i.path, k].join(".")) : [],
    );
    if (fields.length) return { ok: false, code: "unknown_field", fields };
    return { ok: false, code: "invalid_body", fields: r.error.issues.map((i) => i.path.join(".") || "(body)") };
  }
  const stripped = strippedKeys(input, r.data);
  if (stripped.length) return { ok: false, code: "unknown_field", fields: stripped };
  return { ok: true, value: r.data };
}
