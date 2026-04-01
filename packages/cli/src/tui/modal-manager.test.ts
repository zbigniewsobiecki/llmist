import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ModalManager } from "./modal-manager.js";

// Mock the raw-viewer and approval-dialog modules
vi.mock("./raw-viewer.js", () => ({
  showRawViewer: vi.fn(),
}));

vi.mock("./approval-dialog.js", () => ({
  showApprovalDialog: vi.fn(),
}));

import { showApprovalDialog } from "./approval-dialog.js";
import { showRawViewer } from "./raw-viewer.js";

const mockShowRawViewer = vi.mocked(showRawViewer);
const mockShowApprovalDialog = vi.mocked(showApprovalDialog);

/**
 * Helper that creates a mock raw viewer handle with a controllable closed promise.
 */
function createMockViewerHandle() {
  let resolveClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const close = vi.fn(() => resolveClose());
  return { closed, close, resolveClose };
}

describe("ModalManager", () => {
  let manager: ModalManager;
  // Minimal Screen mock — ModalManager only passes it through to the delegate functions
  const mockScreen = {} as Parameters<typeof showRawViewer>[0]["screen"];

  beforeEach(() => {
    manager = new ModalManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // hasActiveModal
  // ─────────────────────────────────────────────────────────────────────────

  describe("hasActiveModal()", () => {
    test("returns false initially", () => {
      expect(manager.hasActiveModal()).toBe(false);
    });

    test("returns true while a raw viewer is open", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      // Start opening — do NOT await so the modal stays open
      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      expect(manager.hasActiveModal()).toBe(true);

      // Clean up
      handle.resolveClose();
      await openPromise;
    });

    test("returns false after the raw viewer is closed", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });
      handle.resolveClose();
      await openPromise;

      expect(manager.hasActiveModal()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // closeAll
  // ─────────────────────────────────────────────────────────────────────────

  describe("closeAll()", () => {
    test("calls close() on the active modal", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      manager.closeAll();

      expect(handle.close).toHaveBeenCalledTimes(1);

      await openPromise;
    });

    test("clears the activeModal reference after calling close()", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      manager.closeAll();
      expect(manager.hasActiveModal()).toBe(false);

      await openPromise;
    });

    test("is a no-op when no modal is open", () => {
      // Should not throw
      expect(() => manager.closeAll()).not.toThrow();
      expect(manager.hasActiveModal()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // showRawViewer
  // ─────────────────────────────────────────────────────────────────────────

  describe("showRawViewer()", () => {
    test("closes existing modal before showing a new one", async () => {
      const firstHandle = createMockViewerHandle();
      const secondHandle = createMockViewerHandle();

      mockShowRawViewer.mockReturnValueOnce(firstHandle).mockReturnValueOnce(secondHandle);

      // Open first modal (don't await — keep it open)
      const firstPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      // Opening second modal must close the first one
      const secondPromise = manager.showRawViewer(mockScreen, { mode: "response" });

      expect(firstHandle.close).toHaveBeenCalledTimes(1);

      // Clean up
      secondHandle.resolveClose();
      await secondPromise;
      await firstPromise;
    });

    test("sets activeModal so hasActiveModal() returns true while open", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      expect(manager.hasActiveModal()).toBe(true);

      handle.resolveClose();
      await openPromise;
    });

    test("clears activeModal after the closed promise resolves", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const openPromise = manager.showRawViewer(mockScreen, { mode: "request" });
      handle.resolveClose();
      await openPromise;

      expect(manager.hasActiveModal()).toBe(false);
    });

    test("passes data fields through to showRawViewer", async () => {
      const handle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(handle);

      const data = {
        mode: "request" as const,
        request: [{ role: "user" as const, content: "hello" }],
        iteration: 3,
        model: "gpt-4o",
      };

      const openPromise = manager.showRawViewer(mockScreen, data);
      handle.resolveClose();
      await openPromise;

      expect(mockShowRawViewer).toHaveBeenCalledWith(
        expect.objectContaining({
          screen: mockScreen,
          mode: "request",
          request: data.request,
          iteration: 3,
          model: "gpt-4o",
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // showApproval
  // ─────────────────────────────────────────────────────────────────────────

  describe("showApproval()", () => {
    test("delegates to showApprovalDialog with correct params", async () => {
      mockShowApprovalDialog.mockResolvedValue("yes");

      const context = {
        gadgetName: "WriteFile",
        parameters: { path: "/tmp/test.txt", content: "hello" },
      };

      const result = await manager.showApproval(mockScreen, context);

      expect(mockShowApprovalDialog).toHaveBeenCalledWith(mockScreen, context);
      expect(result).toBe("yes");
    });

    test("closes existing modal before delegating", async () => {
      const viewerHandle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(viewerHandle);
      mockShowApprovalDialog.mockResolvedValue("no");

      // Open a raw viewer first
      const viewerPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      // Now show approval — should close the viewer first
      const approvalPromise = manager.showApproval(mockScreen, {
        gadgetName: "RunCommand",
        parameters: { command: "rm -rf /" },
      });

      expect(viewerHandle.close).toHaveBeenCalledTimes(1);

      await approvalPromise;
      await viewerPromise;
    });

    test("returns the ApprovalResponse from showApprovalDialog", async () => {
      for (const response of ["yes", "no", "always", "deny", "cancel"] as const) {
        mockShowApprovalDialog.mockResolvedValue(response);
        const result = await manager.showApproval(mockScreen, {
          gadgetName: "TestGadget",
          parameters: {},
        });
        expect(result).toBe(response);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Single-instance pattern
  // ─────────────────────────────────────────────────────────────────────────

  describe("single-instance pattern", () => {
    test("second showRawViewer closes the first before opening", async () => {
      const firstHandle = createMockViewerHandle();
      const secondHandle = createMockViewerHandle();

      mockShowRawViewer.mockReturnValueOnce(firstHandle).mockReturnValueOnce(secondHandle);

      const firstPromise = manager.showRawViewer(mockScreen, { mode: "request" });

      // Second call — first should be closed
      const secondPromise = manager.showRawViewer(mockScreen, { mode: "response" });

      // Only the first modal's close() should have been called (by closeAll)
      expect(firstHandle.close).toHaveBeenCalledTimes(1);
      // Second modal's close should NOT have been called
      expect(secondHandle.close).not.toHaveBeenCalled();

      // Exactly two total showRawViewer calls
      expect(mockShowRawViewer).toHaveBeenCalledTimes(2);

      secondHandle.resolveClose();
      await secondPromise;
      await firstPromise;
    });

    test("showApproval after showRawViewer closes the viewer", async () => {
      const viewerHandle = createMockViewerHandle();
      mockShowRawViewer.mockReturnValue(viewerHandle);
      mockShowApprovalDialog.mockResolvedValue("cancel");

      const viewerPromise = manager.showRawViewer(mockScreen, { mode: "request" });
      expect(manager.hasActiveModal()).toBe(true);

      await manager.showApproval(mockScreen, { gadgetName: "Gadget", parameters: {} });

      // Viewer should have been closed
      expect(viewerHandle.close).toHaveBeenCalledTimes(1);

      await viewerPromise;
    });
  });
});
