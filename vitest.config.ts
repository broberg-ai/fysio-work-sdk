import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The module template imports "@fysio-work/sdk" like a real module does; inside this repo
// that name points at the source, so the template's own tests run in this suite.
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@fysio-work\/sdk\/sandbox$/, replacement: src("sandbox.ts") },
      { find: /^@fysio-work\/sdk$/, replacement: src("index.ts") },
    ],
  },
});
