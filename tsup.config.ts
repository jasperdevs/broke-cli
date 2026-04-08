import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    brokecli: "bin/brokecli.ts",
    sdk: "src/sdk.ts",
    "benchmark-harness": "src/benchmarks/fixed-suite.ts",
  },
  format: ["esm"],
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  target: "node18",
  platform: "node",
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  noExternal: ["marked", "cli-highlight"],
});
