import { defineConfig } from "tsup";
import fs from "node:fs";

// Two bundles, two runtimes. `clean` is off in both — `npm run prebuild` wipes dist once, because a
// per-config clean would race the other config's output.
export default defineConfig([
  {
    // The CLI. Node-targeted, deps left external so `postgres` resolves normally.
    entry: { index: "src/index.mjs" },
    format: ["esm", "cjs"],
    outDir: "dist",
    platform: "node",
    target: "node20",
    shims: true, // rewrites import.meta.url for the cjs build
    // No shebang banner — esbuild already carries the one on src/index.mjs into both formats.
    clean: false,
    // SQL can't be bundled; the CLI reads these off disk and copies them into the user's project.
    onSuccess: async () => {
      fs.cpSync("src/migrations", "dist/migrations", { recursive: true });
    },
  },
  {
    // The edge-function handlers, imported by the generated functions as @fastpix/supabase/deno.
    entry: { deno: "src/deno/index.ts" },
    format: ["esm"],
    outDir: "dist",
    platform: "neutral",
    target: "esnext",
    clean: false,
  },
]);
