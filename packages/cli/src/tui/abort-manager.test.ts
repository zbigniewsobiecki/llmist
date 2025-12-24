import { describe, expect, test } from "bun:test";
import { AbortManager } from "./abort-manager.js";

describe("AbortManager", () => {
	test("getSignal returns same signal until reset", () => {
		const manager = new AbortManager();

		const signal1 = manager.getSignal();
		const signal2 = manager.getSignal();

		expect(signal1).toBe(signal2);
	});

	test("abort triggers signal", () => {
		const manager = new AbortManager();
		const signal = manager.getSignal();

		expect(signal.aborted).toBe(false);

		manager.abort();

		expect(signal.aborted).toBe(true);
	});

	test("reset creates new signal", () => {
		const manager = new AbortManager();
		const signal1 = manager.getSignal();

		manager.abort();
		expect(signal1.aborted).toBe(true);

		manager.reset();
		const signal2 = manager.getSignal();

		expect(signal1).not.toBe(signal2);
		expect(signal2.aborted).toBe(false);
	});

	test("isAborted reflects signal state", () => {
		const manager = new AbortManager();

		// Before any signal is created
		expect(manager.isAborted()).toBe(false);

		// After getting signal but before abort
		manager.getSignal();
		expect(manager.isAborted()).toBe(false);

		// After abort
		manager.abort();
		expect(manager.isAborted()).toBe(true);

		// After reset
		manager.reset();
		expect(manager.isAborted()).toBe(false);
	});

	test("abort is safe to call without controller", () => {
		const manager = new AbortManager();

		// Should not throw
		expect(() => manager.abort()).not.toThrow();
	});

	test("abort is idempotent", () => {
		const manager = new AbortManager();
		manager.getSignal();

		manager.abort();
		manager.abort(); // Should not throw

		expect(manager.isAborted()).toBe(true);
	});
});
