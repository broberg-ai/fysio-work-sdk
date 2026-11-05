// fysio-work CLI. v0 has one command: `fysio-work check [dir]`.
import { checkModuleDir } from "./check";

const [cmd, dir = "."] = process.argv.slice(2);
if (cmd !== "check") {
  console.error("Brug: fysio-work check [mappe]");
  process.exit(2);
}
const findings = checkModuleDir(dir);
for (const f of findings) console.error(`${f.rule}${f.file ? ` ${f.file}:${f.line}` : ""} — ${f.message}`);
if (findings.length) process.exit(1);
console.log("check: ingen fund.");
