import { visibleWidth } from "@akramcode/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter, renderContextGauge } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
	routedModel?: { model: { id: string }; thinkingLevel?: string };
	promptCacheTouch?: { touchedAt: number; ttlMs: number | undefined };
}): AgentSession {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getEntryCount: () => entries.length,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		routedModel: options.routedModel,
		promptCacheTouch: options.promptCacheTouch,
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the physical model a virtual model routed to", () => {
		const session = createSession({
			sessionName: "",
			modelId: "auto",
			reasoning: true,
			thinkingLevel: "high",
			routedModel: { model: { id: "gpt-5.6-luna" }, thinkingLevel: "medium" },
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);

		expect(statsLine).toContain("auto \u2022 high \u2192 gpt-5.6-luna \u2022 medium");
	});

	it("includes summary and tool result usage in the total cost", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.5 },
			},
			branchUsage: {
				input: 20,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.25 },
			},
			compactionUsage: {
				input: 5,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.125 },
			},
			toolUsage: {
				input: 15,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.375 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("$1.250");
	});

	it("updates cached usage totals after an entry is appended", () => {
		const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } };
		const session = createSession({ sessionName: "", usage });
		const footer = new FooterComponent(session, createFooterData(1));
		expect(stripAnsi(footer.render(120)[1])).toContain("$0.500");

		session.sessionManager.getEntries().push({ type: "message", message: { role: "assistant", usage } } as never);
		expect(stripAnsi(footer.render(120)[1])).toContain("$1.000");
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const statsLine = stripAnsi(footer.render(120)[1]);
		expect(statsLine).toContain("CH25.0%");
	});

	it("marks Kimi Coding costs as subscription estimates", () => {
		const session = createSession({
			sessionName: "",
			provider: "kimi-coding",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[1])).toContain("$1.234 (sub)");
	});

	it("marks explicitly identified subscription auth", () => {
		const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[1])).toContain("$0.000 (sub)");
	});

	it("does not mark generic OAuth sign-in as a subscription", () => {
		const session = createSession({
			sessionName: "",
			provider: "openrouter",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));
		const stats = stripAnsi(footer.render(120)[1]);

		expect(stats).toContain("$1.234");
		expect(stats).not.toContain("(sub)");
	});
});

describe("FooterComponent context gauge and speed", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("renders the gauge proportionally, with at least one cell for any usage", () => {
		expect(renderContextGauge(0)).toBe("░".repeat(10));
		expect(renderContextGauge(0.4)).toBe(`█${"░".repeat(9)}`);
		expect(renderContextGauge(37)).toBe(`████${"░".repeat(6)}`);
		expect(renderContextGauge(150)).toBe("█".repeat(10));
	});

	it("shows the gauge and latest tokens/s only when enabled", () => {
		const footer = new FooterComponent(createSession({ sessionName: "" }), createFooterData(1));
		footer.setGenerationSpeed(48.26);
		const hidden = stripAnsi(footer.render(120)[1]);
		expect(hidden).not.toContain("█");
		expect(hidden).not.toContain("tok/s");

		footer.setShowContextGauge(true);
		const shown = stripAnsi(footer.render(120)[1]);
		expect(shown).toContain(`█${"░".repeat(9)} 12.3%/200k`);
		expect(shown).toContain("48.3 tok/s");
	});
});

describe("FooterComponent cache status line", () => {
	const usage = { input: 2, output: 10, cacheRead: 390_000, cacheWrite: 69, cost: { total: 0.1 } };

	beforeAll(() => {
		initTheme(undefined, false);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows hit ratio, token split, and a live countdown from the latest request", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		const session = createSession({
			sessionName: "",
			usage,
			promptCacheTouch: { touchedAt: 1_000_000 - 2_000, ttlMs: 3_600_000 },
		});
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setShowCacheStatus(true);

		const lines = footer.render(120).map(stripAnsi);
		expect(lines).toHaveLength(3);
		expect(lines[2]).toBe("cache ██████████ 100%  read 390k  wrote 69  new 2  ttl 59:58/1h · warm: keep going");
		// The detailed line replaces the CH% figure on the stats line.
		expect(lines[1]).not.toContain("CH");
		expect(footer.hasLiveCacheCountdown()).toBe(true);

		vi.setSystemTime(1_000_000 + 3_600_000);
		const expired = stripAnsi(footer.render(120)[2]);
		expect(expired).toContain("ttl 0:00/1h · cold: next request rewrites the cache");
		expect(footer.hasLiveCacheCountdown()).toBe(false);
	});

	it("omits the countdown when the cache lifetime is unknown and stays within width", () => {
		const session = createSession({
			sessionName: "",
			usage,
			promptCacheTouch: { touchedAt: Date.now(), ttlMs: undefined },
		});
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setShowCacheStatus(true);

		expect(stripAnsi(footer.render(120)[2])).toBe("cache ██████████ 100%  read 390k  wrote 69  new 2");
		for (const line of footer.render(30)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(30);
		}
	});

	it("is hidden when disabled or when the latest response used no cache", () => {
		const cached = new FooterComponent(createSession({ sessionName: "", usage }), createFooterData(1));
		expect(cached.render(120)).toHaveLength(2);

		const uncached = new FooterComponent(
			createSession({ sessionName: "", usage: { ...usage, cacheRead: 0, cacheWrite: 0 } }),
			createFooterData(1),
		);
		uncached.setShowCacheStatus(true);
		expect(uncached.render(120)).toHaveLength(2);
	});
});
