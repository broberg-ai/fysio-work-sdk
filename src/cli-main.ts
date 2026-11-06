// fysio-work CLI: `init <folder>` and `check [folder] [--json]`. Returns the exit code.
import { relative, resolve } from "node:path";
import { checkModuleDir } from "./check";
import { InitError, initModule } from "./init";

const USAGE = [
  "Brug:",
  "  fysio-work init <mappe> [--id <modul-id>] [--name <navn>]   nyt modul",
  "  fysio-work check [mappe] [--json]                          platformens regler",
].join("\n");

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd?: string;
}

export function main(argv: string[], io: CliIo): number {
  const [cmd, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") flags.set("json", true);
    else if (a === "--id" || a === "--name") flags.set(a.slice(2), rest[++i] ?? "");
    else args.push(a);
  }

  if (cmd === "check") {
    const findings = checkModuleDir(resolve(io.cwd ?? ".", args[0] ?? "."));
    if (flags.has("json")) io.out(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
    else if (findings.length)
      for (const f of findings) io.err(`${f.rule}${f.file ? ` ${f.file}:${f.line}` : ""} — ${f.message}`);
    else io.out("check: ingen fund.");
    return findings.length ? 1 : 0;
  }

  if (cmd === "init") {
    if (!args[0]) {
      io.err(USAGE);
      return 2;
    }
    try {
      const { dir, id } = initModule(resolve(io.cwd ?? ".", args[0]), {
        id: flags.get("id") as string | undefined,
        name: flags.get("name") as string | undefined,
      });
      const cdTo = relative(io.cwd ?? process.cwd(), dir) || ".";
      io.out(
        [
          `Modulet «${id}» er oprettet i ${dir}`,
          "",
          "Næste skridt:",
          `  cd ${cdTo}`,
          "  npm install",
          "  npm run dev      # kører modulet mod sandkassen og skriver færdige kald ud",
          "  npm test",
          "  npm run check",
        ].join("\n"),
      );
      return 0;
    } catch (e) {
      if (e instanceof InitError) {
        io.err(e.message);
        return 1;
      }
      throw e;
    }
  }

  io.err(USAGE);
  return 2;
}
