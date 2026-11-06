// `npm run dev`: kører modulet mod sandkassen — en falsk platform på din egen maskine.
import { runSandbox } from "@fysio-work/sdk/sandbox";
import { buildModule } from "./module";

await runSandbox(buildModule);
