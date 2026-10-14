import type { AssistantMessage } from "@akramcode/ai";
import { type Component, Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@akramcode/tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";
import { prefixMessageTime, TIME_PREFIX_WIDTH } from "./user-message.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Label of collapsed thinking when no extension overrides it; replaced by "Thinking…" or "Thought for 12s". */
export const DEFAULT_HIDDEN_THINKING_LABEL = "Thinking...";

export function formatThinkingDuration(ms: number): string {
	const seconds = Math.max(1, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * Renders a child with the dim response time before its first line. Only the first line moves right; the child is
 * rendered that much narrower so it still fits, and later lines keep the normal indent.
 */
class TimePrefixed implements Component {
	private readonly child: Component;
	private readonly outputPad: number;
	private readonly timestamp: number;

	constructor(child: Component, outputPad: number, timestamp: number) {
		this.child = child;
		this.outputPad = outputPad;
		this.timestamp = timestamp;
	}

	invalidate(): void {
		this.child.invalidate();
	}

	render(width: number): string[] {
		const lines = [...this.child.render(Math.max(1, width - TIME_PREFIX_WIDTH))];
		prefixMessageTime(lines, this.outputPad, this.timestamp, undefined, this.outputPad);
		return lines;
	}
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	/** Expanded by app.tools.expand: shows hidden thinking in full. */
	private expanded = false;
	/** Start and end times of thinking runs seen while streaming, by run index. */
	private thinkingTimes = new Map<number, { start: number; end?: number }>();
	/** Show the response time before the first text line, aligned with user messages. */
	private showTime: boolean;
	/**
	 * Set when a tool group summarizes this message's thinking. The message then renders nothing in its own place;
	 * the expanded group shows it through renderInGroup(), next to the calls it led to.
	 */
	private foldedIntoGroup = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = DEFAULT_HIDDEN_THINKING_LABEL,
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		showTime = false,
	) {
		super();
		this.showTime = showTime;

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/** Whether the message renders any text or thinking; tool calls alone render nothing here. */
	hasVisibleContent(): boolean {
		return (
			this.lastMessage?.content.some(
				(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
			) ?? false
		);
	}

	/**
	 * Whether a tool group can absorb this message: it holds only thinking and tool calls, and the thinking
	 * would render as the default one-line label.
	 */
	canFoldIntoToolGroup(): boolean {
		const content = this.lastMessage?.content;
		if (!content || this.lastMessage?.stopReason === "length") return false;
		if (!this.hideThinkingBlock || this.hiddenThinkingLabel !== DEFAULT_HIDDEN_THINKING_LABEL) return false;
		return (
			content.some((c) => c.type === "toolCall") &&
			content.some((c) => c.type === "thinking" && c.thinking.trim()) &&
			!content.some((c) => c.type === "text" && c.text.trim())
		);
	}

	setFoldedIntoGroup(folded: boolean): void {
		this.foldedIntoGroup = folded;
	}

	/** Total duration of finished thinking runs seen while streaming; undefined when none was timed. */
	/**
	 * Title of the latest thinking block, e.g. "Checking home disk usage" from a reasoning summary that starts
	 * with `**Checking home disk usage**`. Undefined when the thinking has no such title.
	 */
	getThinkingTitle(): string | undefined {
		const blocks = this.lastMessage?.content.filter((content) => content.type === "thinking") ?? [];
		for (const block of blocks.reverse()) {
			const title = /^\s*\*\*([^*\n]{1,120})\*\*/.exec(block.thinking)?.[1]?.trim();
			if (title) return title;
		}
		return undefined;
	}

	getThinkingMs(): number | undefined {
		let total: number | undefined;
		for (const times of this.thinkingTimes.values()) {
			if (times.end !== undefined) total = (total ?? 0) + times.end - times.start;
		}
		return total;
	}

	/** The message's content for an expanded tool group that folded it in. */
	renderInGroup(width: number): string[] {
		return super.render(width);
	}

	private getHiddenThinkingLabel(runIndex: number, inProgress: boolean): string {
		if (this.hiddenThinkingLabel !== DEFAULT_HIDDEN_THINKING_LABEL) return this.hiddenThinkingLabel;
		if (inProgress) return "Thinking…";
		const times = this.thinkingTimes.get(runIndex);
		return times?.end !== undefined ? `Thought for ${formatThinkingDuration(times.end - times.start)}` : "Thought";
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		if (this.foldedIntoGroup) return [];
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		let thinkingRunIndex = 0;
		let timeShown = false;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// See docs/adr/coding-agent/modes-interactive-components-assistant-message.md#assistant-text-message-rendering
				const markdown = new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
					transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
				});
				if (this.showTime && !timeShown) {
					timeShown = true;
					this.contentContainer.addChild(new TimePrefixed(markdown, this.outputPad, message.timestamp));
				} else {
					this.contentContainer.addChild(markdown);
				}
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				// See docs/adr/coding-agent/modes-interactive-components-assistant-message.md#spacing-after-thinking-blocks
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const runIndex = thinkingRunIndex++;
				// Any content after the run, including tool calls, ends it.
				const runEnded = !this.isStreaming || i + 1 < message.content.length;
				if (this.isStreaming && !this.thinkingTimes.has(runIndex)) {
					this.thinkingTimes.set(runIndex, { start: Date.now() });
				}
				const times = this.thinkingTimes.get(runIndex);
				if (times && runEnded && times.end === undefined) {
					times.end = Date.now();
				}
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? (this.hideThinkingBlock && !this.expanded);
				const thinkingComponent = hidden
					? new Text(theme.fg("dim", this.getHiddenThinkingLabel(runIndex, !runEnded)), this.outputPad, 0)
					: new Markdown(
							thinkingBlocks.join("\n\n"),
							this.outputPad,
							0,
							this.markdownTheme,
							{
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							},
							{
								transform: createMarkdownTransform(
									"assistant-thinking",
									this.isStreaming,
									this.markdownTransformers,
								),
							},
						);
				this.contentContainer.addChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						this.thinkingVisibilityOverrides.set(runIndex, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// See docs/adr/coding-agent/modes-interactive-components-assistant-message.md#incomplete-response-errors
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
