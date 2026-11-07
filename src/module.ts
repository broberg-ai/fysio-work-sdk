// createModule v0 on Hono (plan F006 §3.1, §3.10). Developer help, NOT a security boundary:
// everything here runs inside the module's own container, so isolation, audit and egress
// are enforced by core, Postgres and the network — never by this file (§0 «Tillidsmodellen»).
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { z } from "zod";
import {
  MODULE_OPERATIONS,
  ManifestStrict,
  PatientDeletedStrict,
  PatientExportStrict,
  PatientRefStrict,
  RUNTIME,
  type Manifest,
} from "./generated/contracts";
import { createCoreClient, type CoreClient } from "./generated/core-client";
import { createLogger, type Logger, type LoggerOptions } from "./log";
import { parseStrict } from "./strict";

/**
 * Who called, as the injected verifier saw it. `claims` are the ticket's verified JWT claims;
 * createModule requires `iss` (= the verifier's issuer), `aud` (= module:<manifest id>),
 * `org` (= the x-fysio-organization-id header) and `data_scope` (organization | self).
 */
export interface Principal {
  subject: string;
  claims?: Record<string, unknown>;
}

/**
 * Verifies the ticket on an incoming call: signature, algorithm and expiry. Injected; core
 * issues the module tickets (path a, F006.2). Throw to reject.
 */
export interface TicketVerifier {
  /** Core's issuer URL. A ticket whose `iss` is anything else is refused. */
  readonly issuer: string;
  verify(ticket: string): Promise<Principal>;
}

/** A module ticket names exactly one module: aud = module:<manifest id>. */
export const MODULE_AUDIENCE_PREFIX = "module:";

/** Organization for this call. `ticket` is core's signed organization ticket (§3.6 A) — opaque here. */
export interface OrganizationContext {
  id: string;
  ticket: string;
}

export interface RequestContext {
  traceId: string;
  principal: Principal;
  organization: OrganizationContext;
  log: Logger;
  core: CoreClient | undefined;
}

export type ModuleEnv = {
  Variables: {
    traceId: string;
    log: Logger;
    principal: Principal;
    ticket: string;
    organization: OrganizationContext;
    core: CoreClient | undefined;
  };
};

export interface GdprHandlers {
  exportPatient(patientId: string, ctx: RequestContext): Promise<Record<string, unknown>>;
  deletePatient(patientId: string, ctx: RequestContext): Promise<void>;
}

export interface CreateModuleOptions {
  manifest: unknown;
  tickets: TicketVerifier;
  gdpr: GdprHandlers;
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  log?: LoggerOptions;
  core?: {
    baseUrl: string;
    /** The ticket to present to core for this call. Which one is OPEN decision #1. */
    ticketFor(call: { principal: Principal; ticket: string; organization: OrganizationContext }): string | Promise<string>;
    fetch?: typeof fetch;
  };
  /** Override of RUNTIME.shutdownGraceSeconds — for tests. */
  shutdownGraceMs?: number;
}

export interface StartOptions {
  port?: number;
  hostname?: string;
  /** Stop gracefully on SIGTERM and exit (default true). */
  handleSignals?: boolean;
}

export interface FysioModule {
  readonly manifest: Manifest;
  /** Validated values of manifest.config.required. */
  readonly config: Readonly<Record<string, string>>;
  /** Add your routes here. Every route you add is behind the ticket and organization checks. */
  readonly app: Hono<ModuleEnv>;
  readonly log: Logger;
  readonly draining: boolean;
  start(options?: StartOptions): Promise<{ port: number }>;
  stop(): Promise<{ timedOut: boolean }>;
}

export class ModuleStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleStartError";
  }
}

const H = RUNTIME.headers;
const TRACE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function fail(c: Context, status: 400 | 401 | 403 | 500 | 503, code: string, message: string, fields?: string[]) {
  const traceId = (c.get("traceId") as string | undefined) ?? "";
  return c.json({ error: { code, message, traceId, ...(fields ? { fields } : {}) } }, status);
}

/** Strict JSON body: unknown field -> 400 unknown_field, never stripped. Read it as `c.var.body`. */
export function strictBody<S extends z.ZodType>(schema: S): MiddlewareHandler<{ Variables: { body: z.output<S> } }> {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return fail(c, 400, "invalid_json", "Kaldet indeholder ikke gyldig JSON.");
    }
    const r = parseStrict(schema, raw);
    if (!r.ok) {
      const message = r.code === "unknown_field" ? "Kaldet indeholder ukendte felter." : "Kaldet er ugyldigt.";
      return fail(c, 400, r.code, message, r.fields);
    }
    c.set("body", r.value as z.output<S>);
    await next();
  };
}

export function createModule(options: CreateModuleOptions): FysioModule {
  // Opstart (§3.10): validate manifest and config — missing value -> do not start, say which.
  const m = ManifestStrict.safeParse(options.manifest);
  if (!m.success) {
    const where = m.error.issues.map((i) => i.path.join(".") || "(manifest)").join(", ");
    throw new ModuleStartError(`Manifestet er ugyldigt: ${where}`);
  }
  const manifest = m.data;
  const env = options.env ?? process.env;
  const missing = manifest.config.required.filter((k) => !env[k]);
  if (missing.length) throw new ModuleStartError(`Mangler konfiguration: ${missing.join(", ")}`);
  const config = Object.freeze(Object.fromEntries(manifest.config.required.map((k) => [k, env[k] as string])));

  const log = createLogger(options.log);
  const graceMs = options.shutdownGraceMs ?? RUNTIME.shutdownGraceSeconds * 1000;
  const app = new Hono<ModuleEnv>();

  let draining = false;
  let inflight = 0;
  let onIdle: (() => void) | undefined;
  let server: Server | undefined;
  let stopping: Promise<{ timedOut: boolean }> | undefined;
  let onSigterm: (() => void) | undefined;

  // Sporings-id, drain gate, svartid — on every call, health included.
  app.use("*", async (c, next) => {
    const started = performance.now();
    const incoming = c.req.header(H.traceId);
    const traceId = incoming && TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
    c.set("traceId", traceId);
    c.set("log", log.child({ traceId }));
    c.header(H.traceId, traceId);
    if (draining) {
      if (c.req.path === MODULE_OPERATIONS.health.path) return c.json({ status: "draining" as const }, 503);
      return fail(c, 503, "draining", "Modulet lukker ned — prøv igen om lidt.");
    }
    inflight++;
    try {
      await next();
    } finally {
      inflight--;
      c.var.log.info("request.done", {
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      });
      if (inflight === 0) onIdle?.();
    }
  });

  app.on(MODULE_OPERATIONS.health.method, MODULE_OPERATIONS.health.path, (c) => c.json({ status: "ok" as const }));

  // Billet-tjek + organisations-kontekst: everything registered after this line requires both.
  app.use("*", async (c, next) => {
    const bearer = /^Bearer (\S+)$/.exec(c.req.header(H.ticket) ?? "");
    if (!bearer) return fail(c, 401, "missing_ticket", "Kaldet mangler en billet.");
    let principal: Principal;
    try {
      principal = await options.tickets.verify(bearer[1]);
    } catch {
      return fail(c, 401, "invalid_ticket", "Billetten er ugyldig eller udløbet.");
    }
    const claims = principal.claims ?? {};
    if (claims.iss !== options.tickets.issuer || claims.aud !== MODULE_AUDIENCE_PREFIX + manifest.id) {
      return fail(c, 401, "invalid_ticket", "Billetten er ugyldig eller udløbet.");
    }
    const organizationId = c.req.header(H.organizationId);
    const organizationTicket = c.req.header(H.organizationTicket);
    if (!organizationId || !organizationTicket) return fail(c, 400, "missing_organization", "Kaldet mangler organisations-kontekst.");
    // The organisation is the TICKET's — the header only names it, so it must agree.
    if (claims.org !== organizationId) return fail(c, 403, "organization_mismatch", "Billetten gælder en anden organisation.");
    if (claims.data_scope !== "organization" && claims.data_scope !== "self") {
      return fail(c, 403, "no_data_scope", "Billetten giver ingen adgang til organisationens data.");
    }
    const organization = { id: organizationId, ticket: organizationTicket };
    c.set("principal", principal);
    c.set("ticket", bearer[1]);
    c.set("organization", organization);
    c.set("log", c.var.log.child({ organizationId }));
    const core = options.core;
    c.set(
      "core",
      core &&
        createCoreClient({
          baseUrl: core.baseUrl,
          fetch: core.fetch,
          context: async () => ({
            ticket: await core.ticketFor({ principal, ticket: bearer[1], organization }),
            organizationId,
            organizationTicket,
            traceId: c.var.traceId,
          }),
        }),
    );
    await next();
  });

  const fromCore: MiddlewareHandler<ModuleEnv> = async (c, next) => {
    if (c.var.principal.subject !== RUNTIME.coreSubject) return fail(c, 403, "forbidden", "Kun platformen må kalde dette.");
    await next();
  };
  const ctxOf = (c: { var: ModuleEnv["Variables"] }): RequestContext => ({
    traceId: c.var.traceId,
    principal: c.var.principal,
    organization: c.var.organization,
    log: c.var.log,
    core: c.var.core,
  });

  const ex = MODULE_OPERATIONS.exportPatient;
  app.on(ex.method, ex.path, fromCore, strictBody(PatientRefStrict), async (c) => {
    const { patientId } = c.var.body;
    const data = await options.gdpr.exportPatient(patientId, ctxOf(c));
    c.var.log.info("gdpr.export", { operation: "exportPatient" });
    return c.json(PatientExportStrict.parse({ patientId, data }), ex.status);
  });
  const del = MODULE_OPERATIONS.deletePatient;
  app.on(del.method, del.path, fromCore, strictBody(PatientRefStrict), async (c) => {
    const { patientId } = c.var.body;
    await options.gdpr.deletePatient(patientId, ctxOf(c));
    c.var.log.info("gdpr.delete", { operation: "deletePatient" });
    return c.json(PatientDeletedStrict.parse({ patientId, deleted: true }), del.status);
  });

  // Fejl: a readable Danish error to the caller; only the error's NAME is logged (no message — it may hold personal data).
  app.onError((err, c) => {
    (c.var.log ?? log).error("request.error", { errorName: err.name, route: c.req.routePath });
    return fail(c, 500, "internal", "Der opstod en fejl i modulet.");
  });

  const stop = (): Promise<{ timedOut: boolean }> => {
    stopping ??= (async () => {
      draining = true;
      if (onSigterm) process.off("SIGTERM", onSigterm);
      log.info("shutdown.start", { inflight });
      const timedOut = await new Promise<boolean>((resolve) => {
        if (inflight === 0) return resolve(false);
        const t = setTimeout(() => resolve(true), graceMs);
        onIdle = () => {
          clearTimeout(t);
          resolve(false);
        };
      });
      if (server) {
        const s = server;
        // The last response may still be on its way out when the counter hits 0, so only
        // connections that have gone idle are closed — unless the grace period ran out.
        await new Promise<void>((resolve) => {
          const sweep = setInterval(() => s.closeIdleConnections(), 25);
          s.close(() => {
            clearInterval(sweep);
            resolve();
          });
          if (timedOut) s.closeAllConnections();
          else s.closeIdleConnections();
        });
      }
      log.info("shutdown.done", { timedOut, inflight });
      return { timedOut };
    })();
    return stopping;
  };

  return {
    manifest,
    config,
    app,
    log,
    get draining() {
      return draining;
    },
    start(opts = {}) {
      if (server) throw new ModuleStartError("Modulet kører allerede.");
      const port = opts.port ?? Number(env.PORT ?? RUNTIME.defaultPort);
      return new Promise((resolve) => {
        server = serve({ fetch: app.fetch, port, hostname: opts.hostname }, (info) => {
          log.info("module.started", { operation: manifest.id });
          resolve({ port: info.port });
        }) as Server;
        if (opts.handleSignals !== false) {
          onSigterm = () => void stop().then(() => process.exit(0));
          process.once("SIGTERM", onSigterm);
        }
      });
    },
    stop,
  };
}
