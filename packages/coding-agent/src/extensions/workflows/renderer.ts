/** Chat rendering of a workflow run: one line, with steps, calls, and output when expanded (Ctrl+O). */

import { Container, Text } from "@akramcode/tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { formatRunBody, formatRunLine, type WorkflowRunDetails } from "./run.ts";

function statusColor(status: WorkflowRunDetails["status"]): "success" | "error" | "warning" | "accent" {
	switch (status) {
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "running":
			return "accent";
		default:
			return "warning";
	}
}

export function renderWorkflowRun(
	details: WorkflowRunDetails,
	expanded: boolean,
	pad: number,
	theme: Theme,
): Container {
	const container = new Container();
	const color = statusColor(details.status);
	container.addChild(new Text(`${theme.fg(color, "●")} ${theme.fg("text", formatRunLine(details))}`, pad, 0));
	if (expanded) {
		const body = formatRunBody(details).join("\n");
		if (body) container.addChild(new Text(theme.fg("muted", body), pad + 2, 0));
	}
	return container;
}
