// Mutation guard: each mutation of src/index.ts must turn the test suite red.
// A test that stays green when the code under it is broken proves nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const file = new URL("../src/index.ts", import.meta.url);
const original = readFileSync(file, "utf8");
const mutations = [
  ["adds an export", (s) => s + "\nexport const createModule = () => {};\n"],
  ["claims the module API exists", (s) => s.replace("moduleApi: false", "moduleApi: true")],
  ["drops the docs link from the welcome", (s) => s.replace("`Læs mere og skriv dig op: ${sdkStatus.docs}`", "\"Læs mere\"")],
];
let survived = 0;
try {
  for (const [name, mutate] of mutations) {
    const m = mutate(original);
    if (m === original) throw new Error(`mutation "${name}" did not change the source`);
    writeFileSync(file, m);
    try {
      execSync("npx vitest run", { stdio: "ignore" });
      console.error(`SURVIVED: ${name}`);
      survived++;
    } catch {
      console.log(`killed: ${name}`);
    }
  }
} finally {
  writeFileSync(file, original);
}
if (survived) process.exit(1);
