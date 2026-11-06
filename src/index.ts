// @fysio-work/sdk — early access. createModule v0 is built and tested against a FAKE core;
// core itself does not exist yet (plan F006). Do not run it in production.

export { createModule, strictBody, fail, ModuleStartError } from "./module";
export type {
  CreateModuleOptions,
  FysioModule,
  GdprHandlers,
  ModuleEnv,
  Principal,
  RequestContext,
  StartOptions,
  TicketVerifier,
  ClinicContext,
} from "./module";
export { createCoreClient, type CoreClient } from "./generated/core-client";
export { CoreError, type CallContext, type CoreClientOptions } from "./core-call";
export * as contracts from "./generated/contracts";
export { createLogger, REDACTED, type Logger, type LoggerOptions, type LogSink } from "./log";
export { parseStrict, strippedKeys } from "./strict";
export { checkSources, checkModuleDir, checkManifest, MANIFEST_FILE, type CheckFinding } from "./check";
/** The Zod the SDK is built with — use it for strictBody so the versions always match. */
export { z } from "zod";

/** Where the SDK stands. */
export const sdkStatus = {
  name: "@fysio-work/sdk",
  stage: "early-access",
  moduleApi: "v0-preview",
  docs: "https://fysio.work/developer/sdk",
} as const;

/** A short welcome for the first people who install the package. */
export function welcome(): string {
  return [
    "Velkommen til fysio.work SDK.",
    "SDK'et er i early access — createModule v0 er en forhåndsversion, der endnu ikke kører mod en rigtig platform.",
    `Læs mere og skriv dig op: ${sdkStatus.docs}`,
  ].join("\n");
}
