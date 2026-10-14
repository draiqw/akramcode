import { type Component, Loader, type TUI, truncateToWidth } from "@akramcode/tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

/** How often the working indicator refreshes its detail (elapsed time, tokens, speed). */
const WORKING_DETAIL_REFRESH_MS = 1000;

export class WorkingStatusIndicator extends StatusIndicator {
	private baseMessage: string;
	private readonly getDetail: (() => string | undefined) | undefined;
	private detailTimer: NodeJS.Timeout | undefined;

	/**
	 * @param getDetail Optional live detail appended after the message, e.g. `12s · ↓ 1.2k tokens · 48.0 tok/s`.
	 * Each refresh requests a render, so the provider must be cheap.
	 * It is re-read once per second and whenever the message changes.
	 */
	constructor(
		ui: TUI,
		message: string,
		indicator?: WorkingIndicatorOptions,
		colorFn?: (text: string) => string,
		getDetail?: () => string | undefined,
	) {
		super(
			"working",
			ui,
			colorFn ?? ((text) => theme.fg("accent", text)),
			colorFn ?? ((text) => theme.fg("muted", text)),
			message,
			indicator,
		);
		this.baseMessage = message;
		this.getDetail = getDetail;
		if (getDetail) {
			this.refreshDetail();
			this.detailTimer = setInterval(() => this.refreshDetail(), WORKING_DETAIL_REFRESH_MS);
			this.detailTimer.unref?.();
		}
	}

	override setMessage(message: string): void {
		this.baseMessage = message;
		super.setMessage(this.composeMessage());
	}

	/** Re-reads the detail now, e.g. after a response finished. */
	refreshDetail(): void {
		super.setMessage(this.composeMessage());
	}

	private composeMessage(): string {
		const detail = this.getDetail?.();
		return detail ? `${this.baseMessage} · ${detail}` : this.baseMessage;
	}

	override dispose(): void {
		if (this.detailTimer) clearInterval(this.detailTimer);
		this.detailTimer = undefined;
		super.dispose();
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
