import { describe, expect, test } from "vitest";
import * as sdk from "../src/index";

describe("@fysio-work/sdk — public surface", () => {
  test("exports exactly the documented API", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "CoreError",
      "ModuleStartError",
      "REDACTED",
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
    ]);
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
