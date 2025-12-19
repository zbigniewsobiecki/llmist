import { SUMMARY_PREFIX } from "./constants.js";
import { runCLI } from "./program.js";

runCLI().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${SUMMARY_PREFIX} Error: ${message}\n`);
  process.exitCode = 1;
});
