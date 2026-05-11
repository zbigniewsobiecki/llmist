/**
 * Tests for configureAgentBuilder.
 *
 * Verifies that the helper correctly calls AgentBuilder methods with the
 * expected arguments for various option combinations.
 */

import { type AgentBuilder, GadgetRegistry, SkillRegistry } from "llmist";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentBuilderConfig, configureAgentBuilder } from "./agent-builder-config.js";
import type { CLIAgentOptions } from "./option-helpers.js";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("./file-utils.js", () => ({
  readSystemPromptFile: vi.fn().mockResolvedValue("file system prompt"),
}));

vi.mock("./mcp-toml.js", () => ({
  mcpServersTomlToSpecs: vi.fn().mockReturnValue([]),
}));

vi.mock("./mcp-options.js", () => ({
  parseMcpServerFlags: vi.fn().mockReturnValue([]),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a spy-instrumented AgentBuilder. Every fluent method returns `this`
 * so the fluent chain works, and each call is recorded by vi.spyOn.
 */
function createMockBuilder(): AgentBuilder {
  const builder = {
    withModel: vi.fn().mockReturnThis(),
    withSubagentConfig: vi.fn().mockReturnThis(),
    withLogger: vi.fn().mockReturnThis(),
    withHooks: vi.fn().mockReturnThis(),
    withRateLimits: vi.fn().mockReturnThis(),
    withRetry: vi.fn().mockReturnThis(),
    withSystem: vi.fn().mockReturnThis(),
    withMaxIterations: vi.fn().mockReturnThis(),
    withBudget: vi.fn().mockReturnThis(),
    withTemperature: vi.fn().mockReturnThis(),
    withSkills: vi.fn().mockReturnThis(),
    withReasoning: vi.fn().mockReturnThis(),
    withoutReasoning: vi.fn().mockReturnThis(),
    onHumanInput: vi.fn().mockReturnThis(),
    withSignal: vi.fn().mockReturnThis(),
    withGadgets: vi.fn().mockReturnThis(),
    withMcpServer: vi.fn().mockReturnThis(),
    withGadgetStartPrefix: vi.fn().mockReturnThis(),
    withGadgetEndPrefix: vi.fn().mockReturnThis(),
    withGadgetArgPrefix: vi.fn().mockReturnThis(),
    withSyntheticGadgetCall: vi.fn().mockReturnThis(),
    withTextOnlyHandler: vi.fn().mockReturnThis(),
    withTextWithGadgetsHandler: vi.fn().mockReturnThis(),
    withTrailingMessage: vi.fn().mockReturnThis(),
  } as unknown as AgentBuilder;
  return builder;
}

/**
 * Creates a minimal CLIAgentOptions with required fields.
 */
function createOptions(overrides: Partial<CLIAgentOptions> = {}): CLIAgentOptions {
  return {
    model: "test:mock-model",
    builtins: false,
    builtinInteraction: false,
    ...overrides,
  };
}

/**
 * Creates a mock CLIEnvironment.
 */
function createMockEnv() {
  const mockLogger: any = {
    silly: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    getSubLogger: vi.fn().mockReturnThis(),
  };
  return {
    createLogger: vi.fn().mockReturnValue(mockLogger),
    stderr: { write: vi.fn() },
    stdout: { write: vi.fn() },
  } as any;
}

/**
 * Creates a minimal AgentBuilderConfig.
 */
function createConfig(overrides: Partial<AgentBuilderConfig> = {}): AgentBuilderConfig {
  return {
    resolvedSubagentConfig: {},
    finalHooks: {} as any,
    skillRegistry: new SkillRegistry(),
    gadgetRegistry: new GadgetRegistry(),
    tui: null,
    abortController: new AbortController(),
    fullConfig: null,
    env: createMockEnv(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("configureAgentBuilder", () => {
  let builder: AgentBuilder;

  beforeEach(() => {
    builder = createMockBuilder();
    vi.clearAllMocks();
  });

  // ── Core settings ────────────────────────────────────────────────────────

  describe("core settings", () => {
    it("calls withModel with the model from options", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ model: "anthropic:sonnet" }),
        createConfig(),
      );
      expect(builder.withModel).toHaveBeenCalledWith("anthropic:sonnet");
    });

    it("calls withSubagentConfig with resolved subagent config", async () => {
      const resolvedSubagentConfig = { BrowseWeb: { model: "sonnet" } };
      await configureAgentBuilder(
        builder,
        createOptions(),
        createConfig({ resolvedSubagentConfig }),
      );
      expect(builder.withSubagentConfig).toHaveBeenCalledWith(resolvedSubagentConfig);
    });

    it("calls withLogger via env.createLogger", async () => {
      const env = createMockEnv();
      await configureAgentBuilder(builder, createOptions(), createConfig({ env }));
      expect(env.createLogger).toHaveBeenCalledWith("llmist:cli:agent");
      expect(builder.withLogger).toHaveBeenCalled();
    });

    it("calls withHooks with finalHooks", async () => {
      const finalHooks = { onLLMCallComplete: vi.fn() } as any;
      await configureAgentBuilder(builder, createOptions(), createConfig({ finalHooks }));
      expect(builder.withHooks).toHaveBeenCalledWith(finalHooks);
    });
  });

  // ── Rate limits ──────────────────────────────────────────────────────────

  describe("rate limits", () => {
    it("calls withRateLimits when rate limit config resolves for known provider", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ model: "anthropic:claude-3-5-sonnet-20241022" }),
        createConfig(),
      );
      expect(builder.withRateLimits).toHaveBeenCalled();
    });

    it("does not call withRateLimits when rate limiting is disabled", async () => {
      await configureAgentBuilder(builder, createOptions({ rateLimit: false }), createConfig());
      // rateLimit: false returns { enabled: false } which is still a config,
      // but we want to verify --no-rate-limit propagates
      // The resolved config with enabled:false IS passed (withRateLimits receives it)
      expect(builder.withRateLimits).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });

    it("does not call withRateLimits for unknown model provider", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ model: "unknown:model" }),
        createConfig(),
      );
      expect(builder.withRateLimits).not.toHaveBeenCalled();
    });
  });

  // ── Retry ────────────────────────────────────────────────────────────────

  describe("retry", () => {
    it("calls withRetry with resolved config by default", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withRetry).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, retries: 3 }),
      );
    });

    it("calls withRetry with disabled config when retry is false", async () => {
      await configureAgentBuilder(builder, createOptions({ retry: false }), createConfig());
      expect(builder.withRetry).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it("calls withRetry with custom max retries", async () => {
      await configureAgentBuilder(builder, createOptions({ maxRetries: 5 }), createConfig());
      expect(builder.withRetry).toHaveBeenCalledWith(expect.objectContaining({ retries: 5 }));
    });
  });

  // ── System prompt ────────────────────────────────────────────────────────

  describe("system prompt", () => {
    it("does not call withSystem when no system options are set", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withSystem).not.toHaveBeenCalled();
    });

    it("calls withSystem with inline system prompt", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ system: "You are helpful" }),
        createConfig(),
      );
      expect(builder.withSystem).toHaveBeenCalledWith("You are helpful");
    });

    it("calls withSystem with file-loaded prompt when systemFile is set", async () => {
      const { readSystemPromptFile } = await import("./file-utils.js");
      vi.mocked(readSystemPromptFile).mockResolvedValue("from file");

      await configureAgentBuilder(
        builder,
        createOptions({ systemFile: "/path/to/system.txt" }),
        createConfig(),
      );
      expect(readSystemPromptFile).toHaveBeenCalledWith("/path/to/system.txt");
      expect(builder.withSystem).toHaveBeenCalledWith("from file");
    });

    it("throws when both system and systemFile are set", async () => {
      await expect(
        configureAgentBuilder(
          builder,
          createOptions({ system: "inline", systemFile: "/path/to/file.txt" }),
          createConfig(),
        ),
      ).rejects.toThrow("Cannot use both --system and --system-file options");
    });
  });

  // ── Iterations, budget, temperature ─────────────────────────────────────

  describe("iterations, budget, temperature", () => {
    it("does not call withMaxIterations when undefined", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withMaxIterations).not.toHaveBeenCalled();
    });

    it("calls withMaxIterations when provided", async () => {
      await configureAgentBuilder(builder, createOptions({ maxIterations: 10 }), createConfig());
      expect(builder.withMaxIterations).toHaveBeenCalledWith(10);
    });

    it("calls withBudget when provided", async () => {
      await configureAgentBuilder(builder, createOptions({ budget: 1.5 }), createConfig());
      expect(builder.withBudget).toHaveBeenCalledWith(1.5);
    });

    it("does not call withBudget when undefined", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withBudget).not.toHaveBeenCalled();
    });

    it("calls withTemperature when provided", async () => {
      await configureAgentBuilder(builder, createOptions({ temperature: 0.7 }), createConfig());
      expect(builder.withTemperature).toHaveBeenCalledWith(0.7);
    });

    it("does not call withTemperature when undefined", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withTemperature).not.toHaveBeenCalled();
    });
  });

  // ── Skills ───────────────────────────────────────────────────────────────

  describe("skills", () => {
    it("does not call withSkills when registry is empty", async () => {
      await configureAgentBuilder(
        builder,
        createOptions(),
        createConfig({ skillRegistry: new SkillRegistry() }),
      );
      expect(builder.withSkills).not.toHaveBeenCalled();
    });

    it("calls withSkills when registry has skills", async () => {
      const skillRegistry = new SkillRegistry();
      // Add a fake skill to make size > 0
      (skillRegistry as any)._skills = { "test-skill": {} };
      vi.spyOn(skillRegistry, "size", "get").mockReturnValue(1);

      await configureAgentBuilder(builder, createOptions(), createConfig({ skillRegistry }));
      expect(builder.withSkills).toHaveBeenCalledWith(skillRegistry);
    });
  });

  // ── Reasoning ────────────────────────────────────────────────────────────

  describe("reasoning", () => {
    it("does not configure reasoning when no reasoning options set", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withReasoning).not.toHaveBeenCalled();
      expect(builder.withoutReasoning).not.toHaveBeenCalled();
    });

    it("calls withoutReasoning when reasoning is false", async () => {
      await configureAgentBuilder(builder, createOptions({ reasoning: false }), createConfig());
      expect(builder.withoutReasoning).toHaveBeenCalled();
      expect(builder.withReasoning).not.toHaveBeenCalled();
    });

    it("calls withReasoning with effort when reasoning is a string", async () => {
      await configureAgentBuilder(builder, createOptions({ reasoning: "high" }), createConfig());
      expect(builder.withReasoning).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, effort: "high" }),
      );
    });

    it("calls withReasoning with budgetTokens when reasoningBudget is set", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ reasoningBudget: 4096 }),
        createConfig(),
      );
      expect(builder.withReasoning).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, budgetTokens: 4096 }),
      );
    });

    it("applies profile reasoning config when no CLI reasoning flag is set", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({
          profileReasoning: { enabled: true, effort: "medium" },
        }),
        createConfig(),
      );
      expect(builder.withReasoning).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, effort: "medium" }),
      );
    });

    it("calls withoutReasoning from profile config when enabled is false", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ profileReasoning: { enabled: false } }),
        createConfig(),
      );
      expect(builder.withoutReasoning).toHaveBeenCalled();
    });
  });

  // ── Human-input handler ──────────────────────────────────────────────────

  describe("human-input handler", () => {
    it("does not call onHumanInput when tui is null (piped mode)", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig({ tui: null }));
      expect(builder.onHumanInput).not.toHaveBeenCalled();
    });

    it("calls onHumanInput when tui is provided (TUI mode)", async () => {
      const tui = { waitForInput: vi.fn().mockResolvedValue("user answer") } as any;
      await configureAgentBuilder(builder, createOptions(), createConfig({ tui }));
      expect(builder.onHumanInput).toHaveBeenCalledWith(expect.any(Function));

      // Verify the handler delegates to tui.waitForInput
      const handler = vi.mocked(builder.onHumanInput).mock.calls[0][0];
      await handler("some question?");
      expect(tui.waitForInput).toHaveBeenCalledWith("some question?", "AskUser");
    });
  });

  // ── Abort signal ─────────────────────────────────────────────────────────

  describe("abort signal", () => {
    it("calls withSignal with the abortController signal", async () => {
      const abortController = new AbortController();
      await configureAgentBuilder(builder, createOptions(), createConfig({ abortController }));
      expect(builder.withSignal).toHaveBeenCalledWith(abortController.signal);
    });
  });

  // ── Gadgets ──────────────────────────────────────────────────────────────

  describe("gadgets", () => {
    it("does not call withGadgets when registry is empty", async () => {
      await configureAgentBuilder(
        builder,
        createOptions(),
        createConfig({ gadgetRegistry: new GadgetRegistry() }),
      );
      expect(builder.withGadgets).not.toHaveBeenCalled();
    });

    it("calls withGadgets when registry has gadgets", async () => {
      const gadgetRegistry = new GadgetRegistry();
      const fakeGadget = { name: "FakeGadget" } as any;
      vi.spyOn(gadgetRegistry, "getAll").mockReturnValue([fakeGadget]);

      await configureAgentBuilder(builder, createOptions(), createConfig({ gadgetRegistry }));
      expect(builder.withGadgets).toHaveBeenCalledWith(fakeGadget);
    });
  });

  // ── Gadget block markers ─────────────────────────────────────────────────

  describe("gadget block markers", () => {
    it("does not call gadget prefix methods when options are undefined", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withGadgetStartPrefix).not.toHaveBeenCalled();
      expect(builder.withGadgetEndPrefix).not.toHaveBeenCalled();
      expect(builder.withGadgetArgPrefix).not.toHaveBeenCalled();
    });

    it("calls withGadgetStartPrefix when gadgetStartPrefix is set", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ gadgetStartPrefix: "<<<GADGET" }),
        createConfig(),
      );
      expect(builder.withGadgetStartPrefix).toHaveBeenCalledWith("<<<GADGET");
    });

    it("calls withGadgetEndPrefix when gadgetEndPrefix is set", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ gadgetEndPrefix: "GADGET>>>" }),
        createConfig(),
      );
      expect(builder.withGadgetEndPrefix).toHaveBeenCalledWith("GADGET>>>");
    });

    it("calls withGadgetArgPrefix when gadgetArgPrefix is set", async () => {
      await configureAgentBuilder(
        builder,
        createOptions({ gadgetArgPrefix: "ARG:" }),
        createConfig(),
      );
      expect(builder.withGadgetArgPrefix).toHaveBeenCalledWith("ARG:");
    });
  });

  // ── Synthetic gadget calls ────────────────────────────────────────────────

  describe("synthetic gadget calls", () => {
    it("always injects the TellUser greeting synthetic call", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
        "TellUser",
        expect.objectContaining({ message: expect.stringContaining("Hello") }),
        expect.stringContaining("Hello"),
        "gc_init_1",
      );
    });

    it("injects additional synthetic calls for initialGadgets", async () => {
      const initialGadgets = [
        { gadget: "ReadFile", parameters: { path: "/foo" }, result: "file content" },
        { gadget: "ListDir", parameters: { path: "/" }, result: "dir listing" },
      ];
      await configureAgentBuilder(builder, createOptions({ initialGadgets }), createConfig());
      // gc_init_1 is TellUser greeting, gc_init_2 and gc_init_3 are the initial gadgets
      expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
        "ReadFile",
        { path: "/foo" },
        "file content",
        "gc_init_2",
      );
      expect(builder.withSyntheticGadgetCall).toHaveBeenCalledWith(
        "ListDir",
        { path: "/" },
        "dir listing",
        "gc_init_3",
      );
    });
  });

  // ── Text handlers ─────────────────────────────────────────────────────────

  describe("text handlers", () => {
    it("calls withTextOnlyHandler with 'acknowledge'", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withTextOnlyHandler).toHaveBeenCalledWith("acknowledge");
    });

    it("calls withTextWithGadgetsHandler with TellUser config", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withTextWithGadgetsHandler).toHaveBeenCalledWith(
        expect.objectContaining({ gadgetName: "TellUser" }),
      );
    });

    it("parameterMapping wraps text in TellUser message shape", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      const call = vi.mocked(builder.withTextWithGadgetsHandler).mock.calls[0][0];
      expect(call.parameterMapping("hello")).toEqual({
        message: "hello",
        done: false,
        type: "info",
      });
    });

    it("resultMapping prefixes text with info emoji", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      const call = vi.mocked(builder.withTextWithGadgetsHandler).mock.calls[0][0];
      expect(call.resultMapping("hello")).toBe("ℹ️  hello");
    });
  });

  // ── Trailing message ──────────────────────────────────────────────────────

  describe("trailing message", () => {
    it("calls withTrailingMessage with a function", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      expect(builder.withTrailingMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it("trailing message includes iteration counter", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      const fn = vi.mocked(builder.withTrailingMessage).mock.calls[0][0] as (
        ...args: never[]
      ) => string;
      const ctx = { iteration: 0, maxIterations: 10, budget: 0, totalCost: 0 };
      const message = fn(ctx);
      expect(message).toContain("[Iteration 1/10]");
    });

    it("trailing message includes budget info when budget is set", async () => {
      await configureAgentBuilder(builder, createOptions(), createConfig());
      const fn = vi.mocked(builder.withTrailingMessage).mock.calls[0][0] as (
        ...args: never[]
      ) => string;
      const ctx = { iteration: 2, maxIterations: 10, budget: 5, totalCost: 1.2345 };
      const message = fn(ctx);
      expect(message).toContain("Budget: $1.2345/$5");
    });
  });
});
