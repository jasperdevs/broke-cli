import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/brokecli.ts"],
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
