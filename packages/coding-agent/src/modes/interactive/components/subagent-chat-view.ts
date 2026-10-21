import type { AgentMessage } from "@akramcode/agent-core";
import type { AssistantMessage } from "@akramcode/ai";
import { type Component, Container, Spacer, truncateToWidth } from "@akramcode/tui";
import type { AgentSession, AgentSessionEvent } from "../../../core/agent-session.ts";
import { formatAgentTitle, formatSubagentStats } from "../../../core/subagents/agent-tool.ts";
import {
	type SubagentInfo,
	type SubagentRegistry,
	subagentElapsedMs,
} from "../../../core/subagents/subagent-registry.ts";
import { theme } from "../theme/theme.ts";
import type { AssistantMessageComponent } from "./assistant-message.ts";
import { keyText } from "./keybinding-hints.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

/** Creates chat components with the main chat's settings, so an agent's chat looks the same. */
export interface ChatComponentFactory {
	userMessage(text: string, timestamp: number): Component;
	assistantMessage(): AssistantMessageComponent;
	toolExecution(toolName: string, toolCallId: string, args: unknown): ToolExecutionComponent;
	/** Add a tool call to `container`, grouped like in the main chat. */
	addToolExecution(container: Container, component: ToolExecutionComponent): void;
}

function userText(message: AgentMessage): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function agentState(agent: SubagentInfo): string {
	const state = agent.status === "running" ? theme.fg("accent", "running") : theme.fg("muted", agent.status);
	return `${state}${theme.fg("dim", ` · ${formatSubagentStats(subagentElapsedMs(agent), agent.usage.totalTokens)}`)}`;
}

/** Header of an agent's chat: title, type, model, and state. */
class SubagentChatHeader implements Component {
	private readonly registry: SubagentRegistry;
	private readonly id: string;

	constructor(registry: SubagentRegistry, id: string) {
		this.registry = registry;
		this.id = id;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const agent = this.registry.get(this.id);
		if (!agent) return [];
		const contentWidth = Math.max(1, width - 2);
		const meta = [agent.agentType, ...(agent.model ? [agent.model] : [])].join(" · ");
		const title = `${formatAgentTitle(agent.description, theme)} ${theme.fg("muted", `· ${meta}`)}`;
		return [
			` ${truncateToWidth(title, contentWidth, "…")}`,
			` ${truncateToWidth(agentState(agent), contentWidth, "…")}`,
		];
	}
}

/**
 * The line right above the editor while an agent's chat is open: which agent the editor writes to,
 * its state, and how to get back or switch. It stays in view however far the chat is scrolled.
 */
export class SubagentChatBar implements Component {
	private readonly registry: SubagentRegistry;
	private readonly id: string;

	constructor(registry: SubagentRegistry, id: string) {
		this.registry = registry;
		this.id = id;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const agent = this.registry.get(this.id);
		if (!agent) return [];
		const target = `${theme.fg("accent", "▸")} ${theme.fg("muted", "writing to")} ${formatAgentTitle(agent.description, theme)}`;
		const hint = theme.fg(
			"dim",
			`${keyText("app.interrupt")} for main chat · ${keyText("app.agents.focus")} to switch`,
		);
		return [` ${truncateToWidth(`${target} ${agentState(agent)}  ${hint}`, Math.max(1, width - 2), "…")}`];
	}
}

/**
 * The chat of one subagent, shown in place of the main chat. It renders the child session's messages
 * and follows its events, so a running agent's output streams in.
 */
export class SubagentChatView extends Container {
	readonly agentId: string;
	private readonly factory: ChatComponentFactory;
	private readonly requestRender: () => void;
	private readonly body = new Container();
	private readonly pendingTools = new Map<string, ToolExecutionComponent>();
	private streamingComponent: AssistantMessageComponent | undefined;
	private readonly unsubscribe: () => void;

	constructor(
		registry: SubagentRegistry,
		agentId: string,
		session: AgentSession,
		factory: ChatComponentFactory,
		requestRender: () => void,
	) {
		super();
		this.agentId = agentId;
		this.factory = factory;
		this.requestRender = requestRender;
		this.addChild(new Spacer(1));
		this.addChild(new SubagentChatHeader(registry, agentId));
		this.addChild(this.body);
		for (const message of session.messages) this.addMessage(message);
		const streaming = session.agent.state.streamingMessage;
		if (session.isStreaming && streaming?.role === "assistant") this.startStreaming(streaming);
		this.unsubscribe = session.subscribe((event) => this.handleEvent(event));
	}

	dispose(): void {
		this.unsubscribe();
	}

	/** The rendered messages and tool calls, for toggles such as tool output expansion. */
	get chatChildren(): readonly Component[] {
		return this.body.children;
	}

	private addMessage(message: AgentMessage): void {
		if (message.role === "user") {
			const text = userText(message);
			if (!text) return;
			this.body.addChild(new Spacer(1));
			this.body.addChild(this.factory.userMessage(text, message.timestamp));
		} else if (message.role === "assistant") {
			const component = this.factory.assistantMessage();
			component.updateContent(message, false);
			this.body.addChild(component);
			for (const content of message.content) {
				if (content.type !== "toolCall") continue;
				const tool = this.factory.toolExecution(content.name, content.id, content.arguments);
				this.factory.addToolExecution(this.body, tool);
				if (message.stopReason === "aborted" || message.stopReason === "error") {
					tool.updateResult({
						content: [{ type: "text", text: message.errorMessage || "Operation aborted" }],
						isError: true,
					});
				} else {
					this.pendingTools.set(content.id, tool);
				}
			}
		} else if (message.role === "toolResult") {
			const tool = this.pendingTools.get(message.toolCallId);
			if (tool) {
				tool.updateResult(message);
				this.pendingTools.delete(message.toolCallId);
			}
		}
	}

	private startStreaming(message: AssistantMessage): void {
		this.streamingComponent = this.factory.assistantMessage();
		this.body.addChild(this.streamingComponent);
		this.updateStreaming(message);
	}

	private updateStreaming(message: AssistantMessage): void {
		this.streamingComponent?.updateContent(message, true);
		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			const existing = this.pendingTools.get(content.id);
			if (existing) {
				existing.updateArgs(content.arguments);
				continue;
			}
			const tool = this.factory.toolExecution(content.name, content.id, content.arguments);
			this.factory.addToolExecution(this.body, tool);
			this.pendingTools.set(content.id, tool);
		}
	}

	private handleEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "user") this.addMessage(event.message);
				else if (event.message.role === "assistant") this.startStreaming(event.message);
				break;
			case "message_update":
				if (event.message.role === "assistant") this.updateStreaming(event.message);
				break;
			case "message_end": {
				if (event.message.role !== "assistant" || !this.streamingComponent) return;
				const message = event.message;
				this.streamingComponent.updateContent(message, false);
				if (message.stopReason === "aborted" || message.stopReason === "error") {
					for (const tool of this.pendingTools.values()) {
						tool.updateResult({
							content: [{ type: "text", text: message.errorMessage || "Operation aborted" }],
							isError: true,
						});
					}
					this.pendingTools.clear();
				} else {
					for (const tool of this.pendingTools.values()) tool.setArgsComplete();
				}
				this.streamingComponent = undefined;
				break;
			}
			case "tool_execution_start": {
				if (event.parentToolCallId) return;
				let tool = this.pendingTools.get(event.toolCallId);
				if (!tool) {
					tool = this.factory.toolExecution(event.toolName, event.toolCallId, event.args);
					this.factory.addToolExecution(this.body, tool);
					this.pendingTools.set(event.toolCallId, tool);
				}
				tool.markExecutionStarted();
				break;
			}
			case "tool_execution_update":
				this.pendingTools.get(event.toolCallId)?.updateResult({ ...event.partialResult, isError: false }, true);
				break;
			case "tool_execution_end": {
				const tool = this.pendingTools.get(event.toolCallId);
				if (!tool) return;
				tool.updateResult({ ...event.result, isError: event.isError });
				this.pendingTools.delete(event.toolCallId);
				break;
			}
			case "agent_end":
				if (this.streamingComponent) {
					this.body.removeChild(this.streamingComponent);
					this.streamingComponent = undefined;
				}
				this.pendingTools.clear();
				break;
			default:
				return;
		}
		this.requestRender();
	}
}
