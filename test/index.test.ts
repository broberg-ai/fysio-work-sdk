import { describe, expect, test } from "vitest";
import * as sdk from "../src/index";

describe("@fysio-work/sdk — public surface", () => {
  test("exports exactly the documented API", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "CoreError",
      "MANIFEST_FILE",
      "MODULE_AUDIENCE_PREFIX",
      "ModuleStartError",
      "REDACTED",
      "checkManifest",
      "checkModuleDir",
      "checkSources",
      "contracts",
      "createCoreClient",
      "createLogger",
      "createModule",
      "fail",
      "parseStrict",
      "sdkStatus",
      "strictBody",
      "strippedKeys",
      "welcome",
      "z",
    ]);
  });

  test("the sandbox is its own entry point, never part of the module runtime", async () => {
    const sandbox = await import("../src/sandbox");
    expect(Object.keys(sandbox).sort()).toEqual(["createSandbox", "runSandbox", "toCurl"]);
    expect(Object.keys(sdk)).not.toContain("createSandbox");
  });

  test("the status says early access and a v0 preview", () => {
    expect(sdk.sdkStatus).toEqual({
      name: "@fysio-work/sdk",
      stage: "early-access",
      moduleApi: "v0-preview",
      docs: "https://fysio.work/developer/sdk",
    });
  });

  test("the welcome points to the docs and does not promise a running platform", () => {
    const w = sdk.welcome();
    expect(w.split("\n")[0]).toBe("Velkommen til fysio.work SDK.");
    expect(w).toContain("https://fysio.work/developer/sdk");
    expect(w).toContain("endnu ikke kører mod en rigtig platform");
  });
});
