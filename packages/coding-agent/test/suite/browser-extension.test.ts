import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@akramcode/ai";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import type { FauxResponseFactory, ToolResultMessage } from "@akramcode/providers/compat";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../../src/core/sdk.ts";
import { type AgentTypeDefinition, discoverAgentTypes } from "../../src/core/subagents/agent-types.ts";
import { BROWSER_AGENT_PROMPT, createBrowserExtension } from "../../src/extensions/browser/index.ts";
import { FakeCdp } from "../browser-fixtures.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const BROWSER_TOOLS = [
	"browser_navigate",
	"browser_state",
	"browser_click",
	"browser_type",
	"browser_select",
	"browser_hover",
	"browser_scroll",
	"browser_keys",
	"browser_back",
	"browser_tabs",
	"browser_screenshot",
	"browser_find_text",
	"browser_wait_for",
];

describe("browser extension", () => {
	const cleanups: (() => void)[] = [];

	afterEach(() => {
		while (cleanups.length > 0) cleanups.pop()?.();
	});

	async function setup(settings = {}) {
		const cdp = new FakeCdp();
		cdp.handlers.set("Target.getTargets", () => ({ targetInfos: [] }));
		let connects = 0;
		const harness: Harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: ["agent", "read"],
			settings,
			extensionFactories: [
				createBrowserExtension({
					connector: {
						resolveUrl: async () => "ws://fake",
						connect: async () => {
							connects++;
							return cdp;
						},
					},
				}),
			],
		});
		cleanups.push(() => harness.cleanup());
		await harness.session.bindExtensions({});
		return { harness, cdp, connects: () => connects };
	}

	it("gives the browser subagent the browser tools and keeps their schemas out of the main agent", async () => {
		const { harness, connects } = await setup();
		const control = harness.session.subagents;
		const browser = control?.listTypes().types.find((type) => type.name === "browser");
		expect(browser).toMatchObject({ source: "extension", tools: ["browser_*"], systemPrompt: BROWSER_AGENT_PROMPT });
		expect(browser?.model).toBeUndefined();
		expect(browser && control?.resolveTools(browser)).toEqual({ tools: BROWSER_TOOLS, unknown: [] });
		// General-purpose agents get the parent's active tools only.
		const general = control?.listTypes().types.find((type) => type.name === "general-purpose");
		expect(general && control?.resolveTools(general).tools).toEqual(["read"]);

		const declared = harness.session.agent.state.tools.map((tool) => tool.name);
		expect(declared.filter((name) => name.startsWith("browser_"))).toEqual([]);
		const exposures = harness.session
			.getAllTools()
			.filter((tool) => tool.name.startsWith("browser_"))
			.map((tool) => [tool.name, tool.exposure, tool.annotations?.readOnlyHint]);
		expect(exposures).toContainEqual(["browser_state", "deferred", true]);
		expect(exposures).toContainEqual(["browser_click", "deferred", false]);
		// Chrome starts on the first browser tool call, not with the session.
		expect(connects()).toBe(0);
	});

	it("runs browser tools for the subagent through the parent", async () => {
		const { harness, connects } = await setup();
		const childTools: string[][] = [];
		let parentStep = 0;
		const respond: FauxResponseFactory = (context) => {
			if (getCurrentSystemPrompt(context.messages).includes("You drive a real Chrome")) {
				childTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
				const ran = context.messages.some((message) => message.role === "toolResult");
				return ran
					? fauxAssistantMessage("no tabs")
					: fauxAssistantMessage(fauxToolCall("browser_tabs", { action: "list" }), { stopReason: "toolUse" });
			}
			parentStep++;
			return parentStep === 1
				? fauxAssistantMessage(
						fauxToolCall("agent", { description: "Web", prompt: "list tabs", subagent_type: "browser" }),
						{ stopReason: "toolUse" },
					)
				: fauxAssistantMessage("done");
		};
		harness.setResponses(Array.from({ length: 10 }, () => respond));
		await harness.session.prompt("browse");

		expect(childTools[0]?.sort()).toEqual([...BROWSER_TOOLS].sort());
		const agentResult = harness.session.messages.find(
			(message): message is ToolResultMessage => message.role === "toolResult" && message.toolName === "agent",
		);
		expect(agentResult && getMessageText(agentResult)).toContain("no tabs");
		expect(connects()).toBe(1);
	});

	it("takes the subagent model from subagents.models", async () => {
		const { harness } = await setup({ subagents: { models: { browser: "faux/cheap" } } });
		const browser = harness.session.subagents?.listTypes().types.find((type) => type.name === "browser");
		expect(browser?.model).toBe("faux/cheap");
	});

	it("lets an agent file replace an extension type, and a project file not", () => {
		const root = mkdtempSync(join(tmpdir(), "akramcode-agent-types-"));
		cleanups.push(() => rmSync(root, { recursive: true, force: true }));
		const extensionTypes: AgentTypeDefinition[] = [
			{ name: "browser", description: "Ext", systemPrompt: "ext", source: "extension" },
			{ name: "general-purpose", description: "Ext general", systemPrompt: "ext", source: "extension" },
		];
		const write = (dir: string, name: string) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: File\n---\nfile\n`);
		};
		write(join(root, "project", ".akramcode", "agents"), "general-purpose");
		const withProject = discoverAgentTypes({
			cwd: join(root, "project"),
			agentDir: join(root, "agent"),
			extensionTypes,
		});
		const byName = (types: AgentTypeDefinition[], name: string) => types.find((type) => type.name === name);
		expect(byName(withProject.types, "general-purpose")?.description).toBe("Ext general");
		expect(withProject.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			'Skipped: a project agent cannot replace the extension agent "general-purpose"',
		]);

		write(join(root, "agent", "agents"), "browser");
		const withUser = discoverAgentTypes({
			cwd: root,
			agentDir: join(root, "agent"),
			extensionTypes,
		});
		expect(byName(withUser.types, "browser")?.source).toBe("user");
	});
});
