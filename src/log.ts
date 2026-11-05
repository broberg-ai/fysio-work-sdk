// Allowlist logging (plan F006 §3.8): only named, structured fields are written — never
// free text. The CPR filter is the last guard, not the guard.
import { RUNTIME } from "./generated/contracts";

export type LogValue = string | number | boolean | null;
export type LogLevel = "info" | "warn" | "error";
export type LogSink = (line: Record<string, unknown>) => void;

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** A logger that adds these fields to every line (they pass the same allowlist). */
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  /** Field names the module may log, besides RUNTIME.alwaysLoggableFields. */
  fields?: readonly string[];
  sink?: LogSink;
}

const EVENT_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
// DDMMYY-SSSS with or without the dash.
const CPR = /(?<!\d)(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}-?\d{4}(?!\d)/g;
export const REDACTED = "[redacted]";

const stdoutSink: LogSink = (line) => process.stdout.write(JSON.stringify(line) + "\n");

export function createLogger(options: LoggerOptions = {}, base: Record<string, unknown> = {}): Logger {
  const allowed = new Set<string>([...RUNTIME.alwaysLoggableFields, ...(options.fields ?? [])]);
  const sink = options.sink ?? stdoutSink;

  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event: EVENT_NAME.test(event) ? event : "invalid_event_name",
    };
    const dropped: string[] = [];
    for (const [key, value] of Object.entries({ ...base, ...fields })) {
      if (!allowed.has(key) || !isLogValue(value)) {
        dropped.push(key);
        continue;
      }
      line[key] = typeof value === "string" ? value.replace(CPR, REDACTED) : value;
    }
    if (dropped.length) line.droppedFields = dropped.sort();
    sink(line);
  };

  return {
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
    child: (fields) => createLogger(options, { ...base, ...fields }),
  };
}

function isLogValue(v: unknown): v is LogValue {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}
