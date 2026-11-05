import { describe, expect, test } from "vitest";
import { checkSources } from "../src/index";

const withModule = (extra: string) => [
  { path: "src/main.ts", content: `import { createModule } from "@fysio-work/sdk";\nconst m = createModule({});\n${extra}` },
];

describe("check v0: a module starts through createModule, never its own server", () => {
  test("a module that only uses createModule has no findings", () => {
    expect(checkSources(withModule("await m.start();"))).toEqual([]);
  });

  test.each([
    ["Bun.serve", "Bun.serve({ fetch: app.fetch });"],
    ["Deno.serve", "Deno.serve(app.fetch);"],
    ["createServer", "http.createServer(handler);"],
    ["@hono/node-server", 'import { serve } from "@hono/node-server";'],
    [".listen()", "app.listen(3000);"],
    ["export default { fetch }", "export default { port: 3000, fetch: app.fetch };"],
  ])("%s is refused with file and line", (_what, line) => {
    const f = checkSources(withModule(line));
    expect(f).toEqual([{ rule: "own-server", file: "src/main.ts", line: 3, message: expect.stringContaining("createModule") }]);
  });

  test("a module that never calls createModule is refused", () => {
    expect(checkSources([{ path: "a.ts", content: "export const x = 1;" }])).toEqual([
      { rule: "no-create-module", message: "Modulet kalder ikke createModule." },
    ]);
  });
});
