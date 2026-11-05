// @fysio-work/sdk — early access.
//
// This first release exists to prove the publishing chain end to end (F006.23).
// It deliberately exports NO module API: createModule and the rest arrive in F006.7,
// and a stub that pretends otherwise would be a promise the package cannot keep.

/** Where the SDK stands. Read it; do not build on anything else yet. */
export const sdkStatus = {
  name: "@fysio-work/sdk",
  stage: "early-access",
  moduleApi: false,
  docs: "https://fysio.work/developer/sdk",
} as const;

/** A short welcome for the first people who install the package. */
export function welcome(): string {
  return [
    "Velkommen til fysio.work SDK.",
    "SDK'et er i early access og under opbygning — modul-API'et (createModule) er ikke udgivet endnu.",
    `Læs mere og skriv dig op: ${sdkStatus.docs}`,
  ].join("\n");
}
