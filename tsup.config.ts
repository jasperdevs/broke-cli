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
  external: ["react-devtools-core"],
  banner: {
    js: "#!/usr/bin/env node",
  },
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "react";
  },
});
