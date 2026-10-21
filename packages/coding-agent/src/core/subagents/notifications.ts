import type { SubagentInfo } from "./subagent-registry.ts";

/** `customType` of the session messages that report a finished agent run the main agent did not wait for. */
export const AGENT_NOTIFICATION_CUSTOM_TYPE = "agent-notification";

/** Longest agent result a notification carries; the full text stays in the transcript. */
const MAX_NOTIFICATION_RESULT_CHARS = 30_000;

export interface AgentNotificationDetails {
	agent: SubagentInfo;
}

function finishedSummary(agent: SubagentInfo): string {
	const subject = `Agent "${agent.description}"`;
	switch (agent.status) {
		case "completed":
			return agent.source === "user" ? `${subject} replied to the user` : `${subject} finished`;
		case "failed":
			return `${subject} failed${agent.error ? `: ${agent.error}` : ""}`;
		case "stopped":
			return `${subject} was stopped`;
		default:
			return `${subject} is running`;
	}
}

/** Text the main agent receives when an agent run it did not wait for ends. */
export function formatAgentFinishedNotification(agent: SubagentInfo): string {
	const lines = [
		"<agent-notification>",
		`<agent-id>${agent.id}</agent-id>`,
		`<status>${agent.status}</status>`,
		`<summary>${finishedSummary(agent)}</summary>`,
	];
	// The main agent did not see what the user told the agent in its chat.
	if (agent.source === "user") lines.push(`<user-message>\n${agent.prompt}\n</user-message>`);
	if (agent.result !== undefined) {
		const result =
			agent.result.length > MAX_NOTIFICATION_RESULT_CHARS
				? `${agent.result.slice(0, MAX_NOTIFICATION_RESULT_CHARS)}\n[Result truncated. Full text: ${agent.transcriptFile ?? "the agent transcript"}]`
				: agent.result;
		lines.push(`<result>\n${result}\n</result>`);
	}
	if (agent.transcriptFile) lines.push(`<transcript>${agent.transcriptFile}</transcript>`);
	lines.push("</agent-notification>");
	return lines.join("\n");
}
