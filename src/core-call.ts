// The one HTTP call every generated core-client method goes through.
import type { z } from "zod";
import { RUNTIME } from "./generated/contracts";

/** Who and what a call to core is about. Core — not the module — decides whether it is allowed (§3.4). */
export interface CallContext {
  /** Ticket presented to core. Which ticket (user vs. service, path a/b) is OPEN decision #1. */
  ticket: string;
  organizationId: string;
  /** Signed organization ticket from core (§3.6 A). Opaque to the SDK; Postgres verifies it. */
  organizationTicket: string;
  traceId: string;
}

export interface CoreClientOptions {
  baseUrl: string;
  /** Resolved per call, so a long-lived client always sends a current ticket. */
  context: () => CallContext | Promise<CallContext>;
  fetch?: typeof fetch;
}

export class CoreError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`core ${operation} svarede ${status}`);
    this.name = "CoreError";
  }
}

export function contextHeaders(ctx: CallContext): Record<string, string> {
  const h = RUNTIME.headers;
  return {
    [h.ticket]: `Bearer ${ctx.ticket}`,
    [h.organizationId]: ctx.organizationId,
    [h.organizationTicket]: ctx.organizationTicket,
    [h.traceId]: ctx.traceId,
  };
}

export async function call<Req, Res>(
  options: CoreClientOptions,
  op: { method: string; path: string; status: number },
  name: string,
  requestSchema: z.ZodType<Req>,
  responseSchema: z.ZodType<Res>,
  body: Req,
): Promise<Res> {
  // Strict before it leaves: an unknown field is a bug in the caller, not something to strip.
  const payload = requestSchema.parse(body);
  const ctx = await options.context();
  const res = await (options.fetch ?? globalThis.fetch)(new URL(op.path, options.baseUrl), {
    method: op.method,
    headers: { "content-type": "application/json", ...contextHeaders(ctx) },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (res.status !== op.status) throw new CoreError(name, res.status, json);
  // Tolerant on the way back: a field core added in a MINOR version is ignored.
  return responseSchema.parse(json);
}
