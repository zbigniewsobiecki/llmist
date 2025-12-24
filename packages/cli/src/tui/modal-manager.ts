/**
 * ModalManager - Manages modal lifecycle with single-instance pattern.
 *
 * Ensures only one modal is open at a time by closing any existing modal
 * before opening a new one. This prevents modal stacking issues.
 */

import type { Screen } from "@unblessed/node";
import type { LLMMessage } from "llmist";
import { showApprovalDialog } from "./approval-dialog.js";
import { type RawViewerMode, showRawViewer } from "./raw-viewer.js";
import type { ApprovalContext, ApprovalResponse } from "./types.js";

export interface RawViewerData {
	mode: RawViewerMode;
	// For LLM calls
	request?: LLMMessage[];
	response?: string;
	iteration?: number;
	model?: string;
	// For gadgets
	gadgetName?: string;
	parameters?: Record<string, unknown>;
	result?: string;
	error?: string;
}

export class ModalManager {
	private activeModal: { close: () => void } | null = null;

	/**
	 * Close any currently open modal.
	 */
	closeAll(): void {
		if (this.activeModal) {
			this.activeModal.close();
			this.activeModal = null;
		}
	}

	/**
	 * Show the raw viewer modal.
	 * Closes any existing modal first (single-instance pattern).
	 */
	async showRawViewer(screen: Screen, data: RawViewerData): Promise<void> {
		this.closeAll();

		const handle = showRawViewer({
			screen,
			mode: data.mode,
			request: data.request,
			response: data.response,
			iteration: data.iteration,
			model: data.model,
			gadgetName: data.gadgetName,
			parameters: data.parameters,
			result: data.result,
			error: data.error,
		});

		this.activeModal = { close: handle.close };

		// Wait for viewer to close and clear the reference
		await handle.closed;
		this.activeModal = null;
	}

	/**
	 * Show the approval dialog.
	 * Closes any existing modal first (single-instance pattern).
	 */
	async showApproval(screen: Screen, context: ApprovalContext): Promise<ApprovalResponse> {
		this.closeAll();

		// Approval dialog is self-contained and returns a response
		// We don't track it as an active modal since it's blocking
		return showApprovalDialog(screen, context);
	}

	/**
	 * Check if a modal is currently open.
	 */
	hasActiveModal(): boolean {
		return this.activeModal !== null;
	}
}
