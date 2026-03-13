import { vi } from "vitest";

/**
 * Mock TUI App interface.
 */
export interface MockTUIApp {
  setProfiles: any;
  setFocusMode: any;
  startWaitingForPrompt: any;
  destroy: any;
  onQuit: any;
  onCancel: any;
  showLLMCallStart: any;
  updateStreamingTokens: any;
  clearRetry: any;
  showThrottling: any;
  addSystemMessage: any;
  clearThrottling: any;
  showRetry: any;
  showApproval: any;
  waitForInput: any;
  subscribeToTree: any;
  handleEvent: any;
  addGadgetCost: any;
  flushText: any;
  resetAbort: any;
  startNewSession: any;
  showUserMessage: any;
  clearPreviousSession: any;
  clearStatusBar: any;
  onMidSessionInput: any;
  waitForPrompt: any;
  getAbortSignal: any;
}

/**
 * Creates a mock TUI app for testing.
 *
 * NOTE: This currently uses Vitest's `vi` for mocks.
 */
export const createMockTUIApp = (): MockTUIApp => {
  const abortController = new AbortController();

  const mock: MockTUIApp = {
    setProfiles: vi.fn(),
    setFocusMode: vi.fn(),
    startWaitingForPrompt: vi.fn(),
    destroy: vi.fn(),
    onQuit: vi.fn(),
    onCancel: vi.fn(),
    showLLMCallStart: vi.fn(),
    updateStreamingTokens: vi.fn(),
    clearRetry: vi.fn(),
    showThrottling: vi.fn(),
    addSystemMessage: vi.fn(() => "block-id"),
    clearThrottling: vi.fn(),
    showRetry: vi.fn(),
    showApproval: vi.fn(async () => "yes"),
    waitForInput: vi.fn(async () => "user input"),
    subscribeToTree: vi.fn(() => () => {}),
    handleEvent: vi.fn(),
    addGadgetCost: vi.fn(),
    flushText: vi.fn(),
    resetAbort: vi.fn(),
    startNewSession: vi.fn(),
    showUserMessage: vi.fn(),
    clearPreviousSession: vi.fn(),
    clearStatusBar: vi.fn(),
    onMidSessionInput: vi.fn(),
    waitForPrompt: vi.fn(),
    getAbortSignal: vi.fn(() => abortController.signal),
  };

  // Only return a prompt once, then throw to break the loop in executeAgent
  mock.waitForPrompt.mockImplementation(async () => {
    if (mock.waitForPrompt.mock.calls.length === 1) {
      return "first prompt";
    }
    const error = new Error("Loop broken for testing purposes");
    (error as any).name = "AbortError";
    throw error;
  });

  return mock;
};
