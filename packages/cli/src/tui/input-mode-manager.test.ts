import { describe, expect, test } from "vitest";
import { InputModeManager } from "./input-mode-manager.js";

describe("InputModeManager", () => {
	describe("initial state", () => {
		test("starts in browse mode with full content", () => {
			const manager = new InputModeManager();
			const state = manager.getState();

			expect(state.focusMode).toBe("browse");
			expect(state.contentFilterMode).toBe("full");
		});
	});

	describe("focus mode transitions", () => {
		test("toggleFocusMode switches browse -> input", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			const changed = manager.toggleFocusMode();

			expect(changed).toBe(true);
			expect(manager.getFocusMode()).toBe("input");
		});

		test("toggleFocusMode switches input -> browse", () => {
			const manager = new InputModeManager();
			manager.setFocusMode("input");

			const changed = manager.toggleFocusMode();

			expect(changed).toBe(true);
			expect(manager.getFocusMode()).toBe("browse");
		});

		test("toggleFocusMode is blocked in focused content mode", () => {
			const manager = new InputModeManager();
			manager.toggleContentFilterMode(); // -> focused
			expect(manager.getFocusMode()).toBe("input"); // forced

			const changed = manager.toggleFocusMode();

			expect(changed).toBe(false);
			expect(manager.getFocusMode()).toBe("input"); // unchanged
		});

		test("setFocusMode(browse) is blocked in focused content mode", () => {
			const manager = new InputModeManager();
			manager.toggleContentFilterMode(); // -> focused

			const changed = manager.setFocusMode("browse");

			expect(changed).toBe(false);
			expect(manager.getFocusMode()).toBe("input");
		});

		test("setFocusMode(input) works in focused content mode", () => {
			const manager = new InputModeManager();
			manager.toggleContentFilterMode(); // -> focused

			// Already in input, should return false (no change)
			const changed = manager.setFocusMode("input");

			expect(changed).toBe(false);
			expect(manager.getFocusMode()).toBe("input");
		});

		test("setFocusMode returns false when mode unchanged", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			const changed = manager.setFocusMode("browse");

			expect(changed).toBe(false);
		});
	});

	describe("content filter mode transitions", () => {
		test("focused mode forces input mode", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.toggleContentFilterMode();

			expect(manager.getContentFilterMode()).toBe("focused");
			expect(manager.getFocusMode()).toBe("input");
		});

		test("full mode allows both focus modes", () => {
			const manager = new InputModeManager();
			manager.toggleContentFilterMode(); // -> focused
			manager.toggleContentFilterMode(); // -> full

			expect(manager.getContentFilterMode()).toBe("full");

			// Should be able to toggle focus mode now
			const changed = manager.toggleFocusMode();
			expect(changed).toBe(true);
		});

		test("toggleContentFilterMode always returns true", () => {
			const manager = new InputModeManager();

			expect(manager.toggleContentFilterMode()).toBe(true);
			expect(manager.toggleContentFilterMode()).toBe(true);
		});

		test("focused mode starting from input mode stays in input", () => {
			const manager = new InputModeManager();
			manager.setFocusMode("input");

			manager.toggleContentFilterMode();

			expect(manager.getContentFilterMode()).toBe("focused");
			expect(manager.getFocusMode()).toBe("input");
		});
	});

	describe("AskUser mode stack", () => {
		test("pushInputMode saves and forces input from browse", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.pushInputMode();

			expect(manager.getFocusMode()).toBe("input");
			expect(manager.hasSavedMode()).toBe(true);
		});

		test("popInputMode restores browse mode", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.pushInputMode();
			expect(manager.getFocusMode()).toBe("input");

			manager.popInputMode();

			expect(manager.getFocusMode()).toBe("browse");
			expect(manager.hasSavedMode()).toBe(false);
		});

		test("pushInputMode from input mode restores input mode", () => {
			const manager = new InputModeManager();
			manager.setFocusMode("input");

			manager.pushInputMode();
			expect(manager.getFocusMode()).toBe("input");

			manager.popInputMode();

			expect(manager.getFocusMode()).toBe("input");
		});

		test("popInputMode without push is a no-op", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.popInputMode();

			expect(manager.getFocusMode()).toBe("browse");
		});

		test("popInputMode respects focused content mode constraint", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.pushInputMode();
			// Now switch to focused mode while in pushed state
			manager.toggleContentFilterMode();

			manager.popInputMode();

			// Should stay in input because focused mode blocks browse
			expect(manager.getFocusMode()).toBe("input");
		});

		test("nested push is not supported (overwrites saved)", () => {
			const manager = new InputModeManager();
			expect(manager.getFocusMode()).toBe("browse");

			manager.pushInputMode(); // saves browse
			manager.pushInputMode(); // saves input (overwrites)

			manager.popInputMode();

			// Restores to input (the second saved value)
			expect(manager.getFocusMode()).toBe("input");
		});
	});

	describe("getState consistency", () => {
		test("getState reflects current state after transitions", () => {
			const manager = new InputModeManager();

			manager.toggleFocusMode();
			manager.toggleContentFilterMode();

			const state = manager.getState();
			expect(state.focusMode).toBe("input"); // forced by focused
			expect(state.contentFilterMode).toBe("focused");
		});
	});
});
