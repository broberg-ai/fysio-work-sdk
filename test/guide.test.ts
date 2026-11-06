// docs/first-module.md, run step by step. If the guide names a command that does not exist,
// or a step stops working, this goes red — the guide cannot break silently.
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "../src/cli-main";
import { runSandbox } from "../src/sandbox";

const guide = readFileSync(new URL("../docs/first-module.md", import.meta.url), "utf8");
const steps = [...guide.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split("\n"));

let stop: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

test("the guide has the steps the test runs, in order", () => {
  expect(steps).toEqual(["npx @fysio-work/sdk init mit-modul", "cd mit-modul", "npm install", "npm run check", "npm run dev", "npm test"]);
});

test("every step of the guide works on a fresh module", async () => {
  let cwd = mkdtempSync(join(tmpdir(), "fysio-work-guide-"));
  const out: string[] = [];
  const io = () => ({ out: (t: string) => out.push(t), err: (t: string) => out.push(t), cwd });
  let pkg: { scripts: Record<string, string>; dependencies: Record<string, string> } | undefined;
  const script = (name: string) => {
    expect(pkg?.scripts[name], `npm script ${name}`).toBeDefined();
    return pkg!.scripts[name];
  };

  for (const step of steps) {
    const [cmd, ...args] = step.split(" ");
    if (step.startsWith("npx @fysio-work/sdk ")) {
      expect(main(args.slice(1), io()), step).toBe(0);
    } else if (cmd === "cd") {
      cwd = join(cwd, args[0]);
      pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    } else if (step === "npm install") {
      expect(Object.keys(pkg!.dependencies)).toEqual(["@fysio-work/sdk"]);
    } else if (step === "npm run check") {
      expect(script("check")).toBe("fysio-work check");
      expect(main(["check"], io()), out.join("\n")).toBe(0);
    } else if (step === "npm run dev") {
      expect(script("dev")).toBe("tsx watch src/dev.ts");
      expect(readFileSync(join(cwd, "src/dev.ts"), "utf8")).toContain("await runSandbox(buildModule);");
      const { buildModule } = await import(pathToFileURL(join(cwd, "src/module.ts")).href);
      const dev = await runSandbox((d) => buildModule({ ...d, log: { sink: () => {} } }), {
        port: 0,
        hostname: "127.0.0.1",
        handleSignals: false,
        print: (t) => out.push(t),
      });
      stop = dev.stop;
      expect((await fetch(`${dev.base}/`, { headers: dev.user })).status).toBe(200);
      const { authorization: _, ...withoutTicket } = dev.user;
      expect((await fetch(`${dev.base}/`, { headers: withoutTicket })).status).toBe(401);
    } else if (step === "npm test") {
      // The template's own tests run in this suite (templates/module/test); here we only
      // prove the script is there and points at them.
      expect(script("test")).toBe("vitest run");
    } else {
      throw new Error(`the guide has a step this test does not know: ${step}`);
    }
  }
});
