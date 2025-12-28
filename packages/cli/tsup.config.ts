import { defineConfig } from "tsup";

export default defineConfig([
  // CLI entry point (with shebang for executable)
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  // Gadgets entry point (library export, no shebang)
  {
    entry: ["src/gadgets/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "node18",
  },
]);
