/**
 * `llmist mcp <subcommand>` — Model Context Protocol management.
 *
 * Plan 2 ships:
 *   - `mcp import-claude-code` — extract MCP server config from
 *     ~/.claude.json and emit TOML blocks for the llmist config.
 *
 * Plan 3 will add:
 *   - `mcp serve` — publish llmist gadgets and skills as an MCP stdio server.
 *
 * @module cli/mcp-command
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Command } from "commander";

import { GadgetRegistry, SkillRegistry, createMcpServer, loadSkillsFromDirectory } from "llmist";
import type { AbstractGadget } from "llmist";
import {
  claudeCodeJsonToTomlBlocks,
  defaultClaudeConfigPath,
  readClaudeCodeMcpConfig,
} from "./import-claude-code.js";
import { isExternalPackageSpecifier, loadExternalGadgets } from "./external-gadgets.js";
import { extractGadgetsFromModule, isTypeScriptFile, createTypeScriptImporter } from "./gadgets.js";
import { pathToFileURL } from "node:url";

async function loadGadgetsFromSpec(spec: string): Promise<AbstractGadget[]> {
  if (isExternalPackageSpecifier(spec)) {
    return loadExternalGadgets(spec);
  }
  // Local file or directory.
  const abs = path.isAbsolute(spec) ? spec : path.resolve(process.cwd(), spec);
  let mod: unknown;
  if (isTypeScriptFile(abs)) {
    const importer = createTypeScriptImporter();
    mod = await importer(abs);
  } else {
    mod = await import(pathToFileURL(abs).href);
  }
  return extractGadgetsFromModule(mod);
}

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("Model Context Protocol commands");

  mcp
    .command("import-claude-code")
    .description(
      "Read ~/.claude.json (or $CLAUDE_CONFIG_HOME) and emit TOML blocks for llmist's mcp.servers config.",
    )
    .option("--source <path>", "Override the source config path")
    .option(
      "--write [path]",
      "Append the blocks to a llmist config file. Default: ~/.llmist/config.toml",
    )
    .action(async (opts: { source?: string; write?: string | boolean }) => {
      try {
        const { source, result } = await readClaudeCodeMcpConfig(opts.source);
        if (result.servers.length === 0) {
          process.stderr.write(`No MCP servers found in ${source}.\n`);
          for (const w of result.warnings) {
            process.stderr.write(`  warning: ${w}\n`);
          }
          process.exit(0);
        }

        const blocks = claudeCodeJsonToTomlBlocks(result.servers);
        const banner = `# Imported from ${source} on ${new Date().toISOString()}\n# Review and edit before keeping.`;
        const tomlText = [banner, ...blocks].join("\n\n") + "\n";

        for (const w of result.warnings) {
          process.stderr.write(`warning: ${w}\n`);
        }

        if (opts.write) {
          const target =
            typeof opts.write === "string" && opts.write.length > 0
              ? opts.write
              : path.join(os.homedir(), ".llmist", "config.toml");
          await fs.mkdir(path.dirname(target), { recursive: true });
          let existing = "";
          try {
            existing = await fs.readFile(target, "utf-8");
          } catch {
            // File doesn't exist yet; that's fine.
          }
          const append = (existing.length > 0 && !existing.endsWith("\n") ? "\n" : "") + tomlText;
          await fs.writeFile(target, existing + append, "utf-8");
          process.stderr.write(`Appended ${result.servers.length} MCP server(s) to ${target}\n`);
        } else {
          process.stdout.write(tomlText);
        }
      } catch (err) {
        process.stderr.write(`mcp import-claude-code failed: ${(err as Error).message}\n`);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          process.stderr.write(
            `(Looked for ${opts.source ?? defaultClaudeConfigPath()}. Set CLAUDE_CONFIG_HOME or pass --source <path>.)\n`,
          );
        }
        process.exit(1);
      }
    });

  mcp
    .command("serve")
    .description(
      "Publish llmist gadgets (and optionally skills) as an MCP stdio server. Add the resulting command to Claude Code, Cursor, Cline, or any MCP client.",
    )
    .option(
      "-g, --gadgets <spec...>",
      "Gadget specifier (local path, npm package, git URL). Repeat for multiple.",
    )
    .option("--skills <dir>", "Directory of SKILL.md files to expose as MCP prompts.")
    .option("--protocol-version <ver>", "MCP protocol version", "2025-06-18")
    .action(
      async (opts: {
        gadgets?: string[];
        skills?: string;
        protocolVersion?: string;
      }) => {
        try {
          const registry = new GadgetRegistry();
          for (const spec of opts.gadgets ?? []) {
            const gadgets = await loadGadgetsFromSpec(spec);
            for (const g of gadgets) {
              registry.registerByClass(g);
            }
          }

          let skills: SkillRegistry | undefined;
          if (opts.skills) {
            const dir = path.isAbsolute(opts.skills)
              ? opts.skills
              : path.resolve(process.cwd(), opts.skills);
            const loaded = loadSkillsFromDirectory(dir, {
              type: "directory",
              path: dir,
            });
            const sr = new SkillRegistry();
            for (const s of loaded) sr.register(s);
            if (sr.size > 0) skills = sr;
          }

          if (registry.getAll().length === 0 && (!skills || skills.size === 0)) {
            process.stderr.write(
              "mcp serve: no gadgets or skills to expose. Pass --gadgets <spec> and/or --skills <dir>.\n",
            );
            process.exit(2);
          }

          const handle = createMcpServer({
            gadgets: registry,
            skills,
            protocolVersion: opts.protocolVersion,
          });

          const { StdioServerTransport } = await import(
            "@modelcontextprotocol/sdk/server/stdio.js"
          );
          const transport = new StdioServerTransport();
          await handle.connect(transport);

          // Stay alive until stdin closes (parent disconnect) or signal.
          const stop = async () => {
            await handle.stop();
            process.exit(0);
          };
          process.on("SIGTERM", stop);
          process.on("SIGINT", stop);
          process.stdin.on("end", stop);
        } catch (err) {
          process.stderr.write(`mcp serve failed: ${(err as Error).message}\n`);
          process.exit(1);
        }
      },
    );
}
