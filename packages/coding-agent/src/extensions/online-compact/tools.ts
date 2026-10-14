/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Ported from NVlabs/SoL-Pi (Online Context Compact) to AkramCode's built-in extension API.
 */
import type { AgentToolResult } from "@akramcode/agent-core";
import { Text } from "@akramcode/tui";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import { PLAN_STATUSES, type PlanStep } from "./plan.ts";

export type PlanProgress = {
	readonly files_changed: readonly string[];
	readonly verification: readonly string[];
	readonly decisions: readonly string[];
};

export type PlanUpdateInput = {
	readonly toolCallId: string;
	readonly steps: readonly PlanStep[];
	readonly progress: PlanProgress | undefined;
	readonly signal: AbortSignal | undefined;
	readonly context: ExtensionContext;
};

export type OnlineToolHandlers = {
	readonly updatePlan: (input: PlanUpdateInput) => Promise<AgentToolResult<Readonly<Record<string, unknown>>>>;
};

const progressSchema = Type.Object(
	{
		files_changed: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 128 }),
		verification: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
		decisions: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
	},
	{ additionalProperties: false },
);

const planStepSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 16_384 }),
		goal: Type.String({ minLength: 1, maxLength: 16_384 }),
		status: Type.Union(PLAN_STATUSES.map((status) => Type.Literal(status))),
	},
	{ additionalProperties: false },
);

export function registerOnlineTools(pi: ExtensionAPI, handlers: OnlineToolHandlers): void {
	pi.registerTool({
		name: "update_plan",
		label: "Update plan",
		description:
			"Replace the complete working plan. Completing a previously registered unfinished step becomes a safe point where the context may be compacted if doing so is economical. Newly introduced completed steps are recorded as history.",
		promptSnippet: "Keep the working plan current",
		promptGuidelines: [
			"Send the complete plan on every update_plan call.",
			"Preserve step IDs and register unfinished steps before reporting their completion.",
			"Keep at most one step in_progress and mark finished steps completed.",
			"When completing a step, include concise progress evidence when available.",
		],
		defaultActive: false,
		parameters: Type.Object(
			{
				steps: Type.Array(planStepSchema, { minItems: 1, maxItems: 128 }),
				progress: Type.Optional(progressSchema),
			},
			{ additionalProperties: false },
		),
		executionMode: "sequential",
		execute: async (toolCallId, params, signal, _onUpdate, context) =>
			await handlers.updatePlan({
				toolCallId,
				steps: params.steps,
				progress: params.progress,
				signal,
				context,
			}),
		renderCall(params, theme) {
			const completed = params.steps.filter((step) => step.status === "completed").length;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("update_plan"))} ${theme.fg("dim", `${params.steps.length} steps, ${completed} completed`)}`,
				0,
				0,
			);
		},
		renderResult(result, { isPartial }, theme) {
			const boundary = (result.details as { boundary?: boolean } | undefined)?.boundary === true;
			const text = isPartial
				? "Updating plan..."
				: boundary
					? "Step completed: compaction checkpoint"
					: "Plan recorded";
			return new Text(theme.fg(isPartial ? "warning" : "dim", text), 0, 0);
		},
	});
}
