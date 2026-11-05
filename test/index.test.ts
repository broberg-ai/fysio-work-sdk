import { describe, expect, test } from "vitest";
import * as sdk from "../src/index";

describe("@fysio-work/sdk — early access", () => {
  test("exports exactly the welcome and the status — no API the package cannot keep", () => {
    expect(Object.keys(sdk).sort()).toEqual(["sdkStatus", "welcome"]);
  });

  test("the status says early access and no module API", () => {
    expect(sdk.sdkStatus).toEqual({
      name: "@fysio-work/sdk",
      stage: "early-access",
      moduleApi: false,
      docs: "https://fysio.work/developer/sdk",
    });
  });

  test("the welcome points to the docs and does not promise createModule exists", () => {
    const w = sdk.welcome();
    expect(w.split("\n")[0]).toBe("Velkommen til fysio.work SDK.");
    expect(w).toContain("https://fysio.work/developer/sdk");
    expect(w).toContain("ikke udgivet endnu");
  });
});
