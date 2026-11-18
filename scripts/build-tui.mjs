import { build } from "esbuild";

// paseo-tui supplies its own React, OpenTUI and plugin API to every plugin
// module; bundling a second copy would split renderer state.
await build({
  entryPoints: ["index.tui.ts"],
  outfile: "dist/tui.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["react", "react/*", "@opentui/*", "paseo-tui/plugin"],
  logLevel: "warning",
});
