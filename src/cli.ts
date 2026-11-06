// fysio-work CLI entry. The logic lives in cli-main.ts so the tests run the same code.
import { main } from "./cli-main";

process.exitCode = main(process.argv.slice(2), {
  out: (t) => console.log(t),
  err: (t) => console.error(t),
  cwd: process.cwd(),
});
