// akramcode traces UI. Plain browser JavaScript, no dependencies. All session content is
// inserted as text (never as HTML), so stored transcripts cannot inject markup or scripts.
"use strict";

const state = {
	version: 0,
	facets: { projects: [], models: [] },
	list: { sessions: [], total: 0 },
	limit: 500,
	sort: { key: "lastActivityAt", dir: -1 },
	detail: undefined,
	detailKey: undefined,
	openIds: new Set(),
	view: { thinking: true, system: false, offPath: true, onlyErrors: false },
	renderToken: 0,
};

// ---------------------------------------------------------------------------
// DOM and formatting helpers
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
	const el = document.createElement(tag);
	if (props) {
		for (const [key, value] of Object.entries(props)) {
			if (value === undefined || value === null || value === false) continue;
			if (key === "class") el.className = value;
			else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
			else if (key === "text") el.textContent = value;
			else el.setAttribute(key, value === true ? "" : String(value));
		}
	}
	appendChildren(el, children);
	return el;
}

function appendChildren(el, children) {
	for (const child of children) {
		if (child === undefined || child === null || child === false) continue;
		if (Array.isArray(child)) appendChildren(el, child);
		else if (child instanceof Node) el.appendChild(child);
		else el.appendChild(document.createTextNode(String(child)));
	}
}

const $ = (id) => document.getElementById(id);

function pad(value) {
	return String(value).padStart(2, "0");
}

function fmtTime(ms) {
	if (!ms) return "";
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDur(ms) {
	if (ms === undefined || ms === null || Number.isNaN(ms)) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${pad(Math.round(s % 60))}s`;
	return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

function fmtNum(n) {
	if (n === undefined || n === null) return "";
	if (n < 1000) return String(Math.round(n * 10) / 10);
	if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
	return `${(n / 1e6).toFixed(1)}M`;
}

function fmtCost(n) {
	if (!n) return "";
	return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function fmtPct(n) {
	return `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
}

function projectName(cwd) {
	if (!cwd) return "(unknown)";
	const parts = cwd.split(/[\\/]/).filter(Boolean);
	return parts.slice(-2).join("/") || cwd;
}

function oneLine(text, max) {
	const line = String(text || "")
		.replace(/\s+/g, " ")
		.trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

// The token comes in the URL fragment (#token=...), which browsers never send to servers or in
// Referer headers. It is kept in sessionStorage for this tab, removed from the address bar, and
// sent as a Bearer header with every API request. No cookie: cookies are not scoped to a port.
const TOKEN_STORAGE_KEY = "akramcode-traces-token";

function takeTokenFromHash() {
	const match = /^#token=([0-9a-f]{64})$/.exec(location.hash);
	if (!match) return;
	try {
		sessionStorage.setItem(TOKEN_STORAGE_KEY, match[1]);
	} catch {}
	history.replaceState(null, "", `${location.pathname}${location.search}#/`);
}

function authToken() {
	try {
		return sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
	} catch {
		return "";
	}
}

function authHeaders(extra) {
	return { ...extra, Authorization: `Bearer ${authToken()}` };
}

function showAuthError() {
	$("app").replaceChildren(
		h(
			"p",
			{ class: "err" },
			"Not authorized. Open the full URL printed by akramcode traces (it contains #token=…). Each run uses a new token.",
		),
	);
}

/** Download an API resource with the token: fetch it, then save it from an object URL. */
async function download(url) {
	const res = await fetch(url, { headers: authHeaders() });
	if (!res.ok) {
		if (res.status === 401) showAuthError();
		return;
	}
	const disposition = res.headers.get("content-disposition") || "";
	const name = /filename="([^"]+)"/.exec(disposition)?.[1] || "download";
	const objectUrl = URL.createObjectURL(await res.blob());
	const link = h("a", { href: objectUrl, download: name });
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function downloadButton(url, label, cls) {
	return h("button", { type: "button", class: cls, onclick: (event) => { event.preventDefault(); event.stopPropagation(); void download(url); } }, label);
}

class AuthError extends Error {
	constructor() {
		super("Not authorized");
	}
}

async function getJson(url) {
	const res = await fetch(url, { headers: authHeaders({ Accept: "application/json" }) });
	if (res.status === 401) {
		showAuthError();
		throw new AuthError();
	}
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			message = (await res.json()).error || message;
		} catch {}
		throw new Error(message);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const FILTER_STORAGE_KEY = "akramcode-traces-filter";

function readFilter() {
	return {
		q: $("f-q").value.trim(),
		project: $("f-project").value,
		model: $("f-model").value,
		subagents: $("f-subagents").value,
		errors: $("f-errors").checked,
		from: $("f-from").value,
		to: $("f-to").value,
	};
}

function filterQuery() {
	const f = readFilter();
	const params = new URLSearchParams();
	if (f.q) params.set("q", f.q);
	if (f.project) params.set("project", f.project);
	if (f.model) params.set("model", f.model);
	if (f.subagents && f.subagents !== "include") params.set("subagents", f.subagents);
	if (f.errors) params.set("errors", "1");
	if (f.from) params.set("from", f.from);
	if (f.to) params.set("to", f.to);
	return params.toString();
}

function saveFilter() {
	try {
		sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(readFilter()));
	} catch {}

}

function restoreFilter() {
	try {
		const saved = JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}");
		$("f-q").value = saved.q || "";
		$("f-subagents").value = saved.subagents || "include";
		$("f-errors").checked = !!saved.errors;
		$("f-from").value = saved.from || "";
		$("f-to").value = saved.to || "";
		state.savedProject = saved.project || "";
		state.savedModel = saved.model || "";
	} catch {}
}

function fillSelect(select, items, allLabel, current, label) {
	const value = current ?? select.value;
	select.replaceChildren(h("option", { value: "" }, allLabel));
	for (const item of items) {
		select.appendChild(h("option", { value: item.value, title: item.value }, `${label(item.value)} (${item.count})`));
	}
	if ([...select.options].some((option) => option.value === value)) select.value = value;
}

async function loadFacets() {
	state.facets = await getJson("/api/facets");
	fillSelect($("f-project"), state.facets.projects, "All projects", state.savedProject, projectName);
	fillSelect($("f-model"), state.facets.models, "All models", state.savedModel, (v) => v);
	state.savedProject = undefined;
	state.savedModel = undefined;
}

let filterTimer;
function onFilterChange() {
	clearTimeout(filterTimer);
	filterTimer = setTimeout(() => {
		saveFilter();
		state.limit = 500;
		const route = parseRoute();
		if (route.name === "session") location.hash = "#/";
		else render();
	}, 200);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function parseRoute() {
	const hash = location.hash.replace(/^#/, "") || "/";
	const session = /^\/s\/([0-9a-f]{16})(?:\/(.+))?$/.exec(hash);
	if (session) return { name: "session", key: session[1], entryId: session[2] && decodeURIComponent(session[2]) };
	if (hash.startsWith("/insights")) return { name: "insights" };
	if (hash.startsWith("/network")) return { name: "network" };
	return { name: "sessions" };
}

function sessionHref(key, entryId) {
	return `#/s/${key}${entryId ? `/${encodeURIComponent(entryId)}` : ""}`;
}

async function render(options = {}) {
	const route = parseRoute();
	$("tab-sessions").classList.toggle("active", route.name === "sessions");
	$("tab-insights").classList.toggle("active", route.name === "insights");
	$("tab-network").classList.toggle("active", route.name === "network");
	const token = ++state.renderToken;
	try {
		if (route.name === "session") await renderSession(route, token, options);
		else if (route.name === "insights") await renderInsights(token);
		else if (route.name === "network") await renderNetwork(token);
		else await renderSessions(token);
	} catch (error) {
		// The auth message is already shown; keep it instead of a generic failure.
		if (token === state.renderToken && !(error instanceof AuthError)) {
			$("app").replaceChildren(h("p", { class: "err" }, `Failed to load: ${error.message}`));
		}
	}
}

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

const COLUMNS = [
	{ key: "lastActivityAt", label: "Last activity", value: (s) => s.lastActivityAt, render: (s) => fmtTime(s.lastActivityAt) },
	{ key: "cwd", label: "Project", value: (s) => s.cwd, render: (s) => h("span", { title: s.cwd }, projectName(s.cwd)) },
	{
		key: "firstMessage",
		label: "Session",
		cls: "first",
		value: (s) => s.name || s.firstMessage,
		render: (s) => [
			s.isSubagent ? h("span", { class: "badge" }, "subagent") : null,
			s.childKeys.length ? h("span", { class: "badge" }, `${s.childKeys.length} subagents`) : null,
			h("span", { title: s.firstMessage }, s.name || s.firstMessage),
		],
	},
	{ key: "primaryModel", label: "Model", value: (s) => s.primaryModel || "", render: (s) => s.primaryModel || "" },
	{ key: "userMessages", label: "Turns", num: true, value: (s) => s.userMessages, render: (s) => s.userMessages },
	{ key: "toolCalls", label: "Tools", num: true, value: (s) => s.toolCalls, render: (s) => s.toolCalls },
	{
		key: "errors",
		label: "Errors",
		num: true,
		value: (s) => s.toolErrors + s.assistantErrors,
		render: (s) => {
			const n = s.toolErrors + s.assistantErrors;
			return n ? h("span", { class: "err", title: `${s.toolErrors} tool, ${s.assistantErrors} model` }, n) : "";
		},
	},
	{ key: "tokens", label: "Tokens", num: true, value: (s) => s.tokens.total, render: (s) => fmtNum(s.tokens.total) },
	{ key: "cost", label: "Cost", num: true, value: (s) => s.cost, render: (s) => fmtCost(s.cost) },
	{ key: "durationMs", label: "Duration", num: true, value: (s) => s.durationMs, render: (s) => fmtDur(s.durationMs) },
	{ key: "lastStopReason", label: "End", value: (s) => s.lastStopReason || "", render: (s) => endBadge(s) },
];

function endBadge(s) {
	const reason = s.lastStopReason;
	if (!reason) return h("span", { class: "badge" }, "no reply");
	if (reason === "error") return h("span", { class: "badge error" }, "error");
	if (reason === "aborted") return h("span", { class: "badge warn" }, "aborted");
	if (reason === "toolUse") return h("span", { class: "badge warn", title: "Ended while waiting for a tool" }, "in tool");
	if (reason === "length") return h("span", { class: "badge warn" }, "length");
	return h("span", { class: "badge ok" }, reason);
}

async function renderSessions(token) {
	const data = await getJson(`/api/sessions?${filterQuery()}&limit=${state.limit}`);
	if (token !== state.renderToken) return;
	state.list = data;
	state.version = data.version;
	const col = COLUMNS.find((c) => c.key === state.sort.key) || COLUMNS[0];
	const sessions = [...data.sessions].sort((a, b) => {
		const va = col.value(a);
		const vb = col.value(b);
		return (va < vb ? -1 : va > vb ? 1 : 0) * state.sort.dir;
	});
	const withErrors = data.sessions.filter((s) => s.toolErrors + s.assistantErrors > 0).length;
	const head = h(
		"tr",
		null,
		COLUMNS.map((c) =>
			h(
				"th",
				{
					class: `sortable${c.num ? " num" : ""}`,
					onclick: () => {
						state.sort = { key: c.key, dir: state.sort.key === c.key ? -state.sort.dir : -1 };
						render();
					},
				},
				c.label,
				state.sort.key === c.key ? (state.sort.dir < 0 ? " ↓" : " ↑") : "",
			),
		),
	);
	const rows = sessions.map((s) =>
		h(
			"tr",
			{ class: "row", onclick: () => (location.hash = sessionHref(s.key)) },
			COLUMNS.map((c) => h("td", { class: [c.num ? "num" : "", c.cls || ""].join(" ").trim() || undefined }, c.render(s))),
		),
	);
	$("app").replaceChildren(
		h(
			"p",
			{ class: "summary-line" },
			`${data.total} sessions`,
			data.total > data.sessions.length ? ` (showing ${data.sessions.length})` : "",
			withErrors ? ` · ${withErrors} with errors on this page` : "",
		),
		data.total === 0
			? h("p", { class: "muted" }, "No sessions match. Sessions appear here as soon as akramcode writes them.")
			: h("table", null, h("thead", null, head), h("tbody", null, rows)),
		data.total > data.sessions.length
			? h(
					"button",
					{
						class: "more",
						onclick: () => {
							state.limit += 500;
							render();
						},
					},
					"Show more",
				)
			: null,
	);
}

// ---------------------------------------------------------------------------
// Session detail
// ---------------------------------------------------------------------------

function usageLine(e) {
	const parts = [];
	if (e.usage) {
		parts.push(`in ${fmtNum(e.usage.input)}`, `out ${fmtNum(e.usage.output)}`);
		if (e.usage.cacheRead) parts.push(`cache ${fmtNum(e.usage.cacheRead)}`);
		if (e.usage.cacheWrite) parts.push(`write ${fmtNum(e.usage.cacheWrite)}`);
	}
	if (e.cost) parts.push(fmtCost(e.cost));
	return parts.join(" · ");
}

function toolPreview(name, argsText) {
	let args;
	try {
		args = JSON.parse(argsText);
	} catch {
		return oneLine(argsText, 140);
	}
	if (!args || typeof args !== "object") return "";
	const pick = args.command ?? args.path ?? args.file_path ?? args.pattern ?? args.description ?? args.url ?? args.query;
	if (typeof pick === "string") return oneLine(pick, 140);
	return oneLine(JSON.stringify(args), 140);
}

function truncatedNote(n) {
	return n ? h("div", { class: "truncated" }, `[${n} more characters; use Raw JSONL for the full text]`) : null;
}

function trackOpen(el, id) {
	if (state.openIds.has(id)) el.open = true;
	el.addEventListener("toggle", () => {
		if (el.open) state.openIds.add(id);
		else state.openIds.delete(id);
	});
	return el;
}

function renderToolCall(block, result) {
	const isError = result?.isError;
	const summary = h(
		"summary",
		null,
		h("span", { class: "tool-name" }, block.name),
		" ",
		h("span", { class: "tool-preview" }, toolPreview(block.name, block.args)),
		result?.durationMs !== undefined ? h("span", { class: "muted" }, ` · ${fmtDur(result.durationMs)}`) : null,
		isError ? h("span", { class: "badge error" }, "error") : null,
		result ? null : h("span", { class: "badge warn" }, "no result"),
		result?.childKey ? h("span", { class: "badge" }, "subagent") : null,
	);
	const body = [
		h("div", { class: "section-label" }, "Arguments"),
		h("pre", null, block.args),
		truncatedNote(block.truncated),
	];
	if (result) {
		body.push(
			h("div", { class: "section-label" }, `Result${result.images ? ` (+${result.images} images)` : ""}`),
			h("pre", { class: isError ? "error" : undefined }, result.text || "(empty)"),
			truncatedNote(result.truncated),
		);
		if (result.childKey) {
			body.push(h("div", null, h("a", { href: sessionHref(result.childKey) }, "Open subagent transcript →")));
		} else if (result.childPath) {
			body.push(h("div", { class: "muted mono" }, `Transcript (not indexed): ${result.childPath}`));
		}
		if (result.data) {
			body.push(h("details", null, h("summary", { class: "muted" }, "details"), h("pre", null, result.data)));
		}
	}
	const captured = state.captureTools?.get(block.id);
	if (captured) body.push(renderCapturedTool(captured));
	const el = h("details", { class: `tool${isError ? " error" : ""}`, id: result?.id ? `e-${result.id}` : undefined }, summary, body);
	return trackOpen(el, `call:${block.id}`);
}

function eventMatchesErrors(e, results) {
	if (e.isError || e.stopReason === "error" || e.stopReason === "aborted") return true;
	if (e.kind === "assistant") {
		return (e.blocks || []).some((b) => b.type === "toolCall" && (results.get(b.id)?.isError || !results.get(b.id)));
	}
	return false;
}

function renderEvent(e, results, delta) {
	const classes = ["event", e.kind];
	const failed =
		e.isError ||
		e.stopReason === "error" ||
		(e.kind === "assistant" && (e.blocks || []).some((b) => b.type === "toolCall" && results.get(b.id)?.isError));
	if (failed) classes.push("is-error");
	if (e.offPath) classes.push("off-path");
	if (e.omitted) classes.push("omitted");

	const head = h(
		"div",
		{ class: "event-head" },
		h("span", { class: "delta", title: fmtTime(e.timestamp) }, delta),
		h("span", { class: "kind" }, kindLabel(e)),
		e.model && e.kind !== "model_change" ? h("span", null, e.model) : null,
		e.latencyMs !== undefined ? h("span", { title: "Model response time" }, fmtDur(e.latencyMs)) : null,
		usageLine(e) ? h("span", null, usageLine(e)) : null,
		e.stopReason && e.stopReason !== "stop" && e.stopReason !== "toolUse" ? endBadge({ lastStopReason: e.stopReason }) : null,
		e.branchPoint ? h("span", { class: "badge", title: "Several branches continue from here" }, "branch point") : null,
		e.offPath ? h("span", { class: "badge", title: "Not on the final branch" }, "abandoned branch") : null,
		e.id ? h("a", { href: sessionHref(state.detailKey, e.id), class: "muted mono", title: "Link to this entry" }, e.id) : null,
	);

	const body = [];
	switch (e.kind) {
		case "user":
			body.push(h("div", { class: "text" }, e.text), truncatedNote(e.truncated));
			if (e.images) body.push(h("div", { class: "muted" }, `+${e.images} images`));
			break;
		case "assistant":
			for (const block of e.blocks || []) {
				if (block.type === "text") body.push(h("div", { class: "text" }, block.text), truncatedNote(block.truncated));
				else if (block.type === "thinking" && state.view.thinking) {
					const el = h(
						"details",
						{ class: "thinking" },
						h("summary", { class: "muted" }, block.redacted ? "thinking (redacted)" : `thinking: ${oneLine(block.text, 120)}`),
						h("div", { class: "text" }, block.text),
						truncatedNote(block.truncated),
					);
					body.push(trackOpen(el, `thinking:${e.id}:${body.length}`));
				} else if (block.type === "toolCall") body.push(renderToolCall(block, results.get(block.id)));
			}
			if (e.errorMessage) body.push(h("pre", { class: "error" }, e.errorMessage));
			body.push(renderRequestLinks(e));
			break;
		case "toolResult":
			body.push(
				h("div", null, h("span", { class: "tool-name mono" }, e.toolName), e.durationMs !== undefined ? ` · ${fmtDur(e.durationMs)}` : ""),
				h("pre", { class: e.isError ? "error" : undefined }, e.text || "(empty)"),
				truncatedNote(e.truncated),
			);
			break;
		case "bash":
			body.push(
				h("div", { class: "mono" }, `$ ${e.command || ""}`, e.exitCode !== null ? `  (exit ${e.exitCode})` : ""),
				h("pre", { class: e.isError ? "error" : undefined }, e.text || "(no output)"),
				truncatedNote(e.truncated),
			);
			break;
		case "system":
			body.push(
				h(
					"div",
					{ class: "muted" },
					e.sections?.length ? `sections: ${e.sections.join(", ")}` : "",
					e.toolsAdded?.length ? ` · tools added: ${e.toolsAdded.join(", ")}` : "",
					e.toolsRemoved?.length ? ` · tools removed: ${e.toolsRemoved.join(", ")}` : "",
				),
			);
			if (state.view.system && e.text) body.push(h("pre", null, e.text), truncatedNote(e.truncated));
			break;
		case "compaction":
			body.push(
				h("div", { class: "muted" }, e.tokensBefore ? `${fmtNum(e.tokensBefore)} tokens summarized` : ""),
				trackOpen(h("details", null, h("summary", null, "summary"), h("div", { class: "text" }, e.text)), `compaction:${e.id}`),
			);
			break;
		case "branch_summary":
			body.push(
				h("div", { class: "muted" }, e.targetId ? `summarized branch ending at ${e.targetId}` : ""),
				trackOpen(h("details", null, h("summary", null, "summary"), h("div", { class: "text" }, e.text)), `branch:${e.id}`),
			);
			break;
		case "custom_message":
			body.push(h("div", { class: "text" }, e.text), truncatedNote(e.truncated));
			if (e.childKey) body.push(h("a", { href: sessionHref(e.childKey) }, "Open subagent transcript →"));
			if (e.data) body.push(h("details", null, h("summary", { class: "muted" }, "details"), h("pre", null, e.data)));
			break;
		case "model_change":
			body.push(h("div", null, e.model || ""));
			break;
		case "thinking_level_change":
			body.push(h("div", null, e.thinkingLevel || ""));
			break;
		case "context_edit":
			body.push(
				h(
					"div",
					{ class: "muted" },
					e.text === undefined ? "omit " : "replace ",
					e.targetId ? h("a", { href: sessionHref(state.detailKey, e.targetId) }, e.targetId) : "",
					" from model context",
				),
			);
			if (e.text) body.push(h("pre", null, e.text));
			break;
		case "label":
			body.push(h("div", null, e.label ? `label "${e.label}" on ${e.targetId}` : `label cleared on ${e.targetId}`));
			break;
		case "session_info":
			body.push(h("div", null, e.text ? `name: ${e.text}` : "name cleared"));
			break;
		case "usage":
			body.push(h("div", { class: "muted" }, `${e.customType || "usage"}${e.model ? ` · ${e.model}` : ""}`));
			break;
		default:
			if (e.data) body.push(h("pre", null, e.data));
	}
	return h("div", { class: classes.join(" "), id: e.id ? `e-${e.id}` : undefined }, head, body);
}

function kindLabel(e) {
	switch (e.kind) {
		case "custom_message":
			return e.customType || "message";
		case "custom":
			return `custom ${e.customType || ""}`;
		case "toolResult":
			return "tool result";
		case "thinking_level_change":
			return "thinking level";
		case "model_change":
			return "model";
		case "branch_summary":
			return "branch summary";
		case "context_edit":
			return "context edit";
		case "session_info":
			return "session name";
		default:
			return e.kind;
	}
}

function metaRow(label, value) {
	if (value === undefined || value === null || value === "") return null;
	return [h("dt", null, label), h("dd", null, value)];
}

function relatedItem(item) {
	return h(
		"li",
		null,
		h("a", { href: sessionHref(item.key) }, oneLine(item.name || item.firstMessage, 100)),
		h("span", { class: "muted" }, ` · ${fmtTime(item.startedAt)} · ${item.toolCalls} tools`),
		item.toolErrors + item.assistantErrors ? h("span", { class: "err" }, ` · ${item.toolErrors + item.assistantErrors} errors`) : null,
	);
}

function toggle(label, key) {
	return h(
		"label",
		{ class: "check" },
		h("input", {
			type: "checkbox",
			checked: state.view[key],
			onchange: (event) => {
				state.view[key] = event.target.checked;
				renderDetail(undefined, { keepScroll: true });
			},
		}),
		` ${label}`,
	);
}

async function renderSession(route, token, options) {
	if (state.detailKey !== route.key) {
		state.openIds = new Set();
		state.detail = undefined;
	}
	const [data, capture] = await Promise.all([
		getJson(`/api/sessions/${route.key}`),
		getJson(`/api/sessions/${route.key}/capture`).catch(() => undefined),
	]);
	if (token !== state.renderToken) return;
	state.detail = data;
	state.capture = capture;
	state.detailKey = route.key;
	state.version = data.version;
	renderDetail(route.entryId, options);
}

function renderDetail(entryId, options = {}) {
	const data = state.detail;
	if (!data) return;
	const s = data.summary;
	const scrollY = window.scrollY;
	indexCapture();
	const results = new Map();
	for (const e of data.events) if (e.kind === "toolResult" && e.toolCallId) results.set(e.toolCallId, e);
	const callIds = new Set();
	for (const e of data.events) for (const b of e.blocks || []) if (b.type === "toolCall") callIds.add(b.id);

	const events = [];
	let previous;
	for (const e of data.events) {
		if (e.kind === "toolResult" && e.toolCallId && callIds.has(e.toolCallId)) continue;
		if (!state.view.offPath && e.offPath) continue;
		if (state.view.onlyErrors && !eventMatchesErrors(e, results)) continue;
		const delta = previous !== undefined && e.timestamp !== undefined ? `+${fmtDur(Math.max(0, e.timestamp - previous))}` : "";
		if (e.timestamp !== undefined) previous = e.timestamp;
		events.push(renderEvent(e, results, delta));
	}

	const title = s.name || s.firstMessage;
	const errors = s.toolErrors + s.assistantErrors;
	const related = [];
	if (data.parent) related.push(h("div", null, "Parent session: ", h("a", { href: sessionHref(data.parent.key) }, oneLine(data.parent.name || data.parent.firstMessage, 100))));
	if (data.forkParent) related.push(h("div", null, "Forked from: ", h("a", { href: sessionHref(data.forkParent.key) }, oneLine(data.forkParent.name || data.forkParent.firstMessage, 100))));
	else if (s.forkParentPath) related.push(h("div", { class: "muted" }, `Forked from (not indexed): ${s.forkParentPath}`));
	if (data.children?.length) related.push(h("div", null, `Subagent transcripts (${data.children.length}):`, h("ul", null, data.children.map(relatedItem))));

	$("app").replaceChildren(
		h(
			"div",
			{ class: "detail-head" },
			h("div", null, h("a", { href: "#/" }, "← Sessions")),
			h("h1", null, s.isSubagent ? h("span", { class: "badge" }, "subagent") : null, oneLine(title, 200)),
			h(
				"dl",
				{ class: "meta" },
				metaRow("Project", s.cwd),
				metaRow("File", h("span", { class: "mono" }, s.path)),
				metaRow("Session id", h("span", { class: "mono" }, s.sessionId)),
				metaRow("Started", `${fmtTime(s.startedAt)} · ran ${fmtDur(s.durationMs)} · last activity ${fmtTime(s.lastActivityAt)}`),
				metaRow("Models", s.models.join(", ")),
				metaRow("Thinking", s.thinkingLevels.join(", ")),
				metaRow(
					"Activity",
					`${s.userMessages} user turns · ${s.assistantMessages} model calls · ${s.toolCalls} tool calls · ${s.compactions} compactions · ${s.branchPoints} branch points`,
				),
				metaRow(
					"Problems",
					errors || s.retries || s.abortedMessages || s.orphanToolCalls
						? h(
								"span",
								{ class: errors ? "err" : "warn" },
								`${s.toolErrors} tool errors · ${s.assistantErrors} model errors · ${s.retries} retries · ${s.abortedMessages} aborted · ${s.orphanToolCalls} tool calls without result · longest tool error streak ${s.maxToolErrorStreak}`,
							)
						: "none",
				),
				metaRow(
					"Tokens",
					`${fmtNum(s.tokens.total)} total · in ${fmtNum(s.tokens.input)} · out ${fmtNum(s.tokens.output)} · cache read ${fmtNum(s.tokens.cacheRead)} · cache write ${fmtNum(s.tokens.cacheWrite)}${s.cost ? ` · ${fmtCost(s.cost)}` : ""}`,
				),
				metaRow("Model latency", s.latency.count ? `avg ${fmtDur(s.latency.totalMs / s.latency.count)} · max ${fmtDur(s.latency.maxMs)}` : ""),
				metaRow("File health", s.malformedLines ? h("span", { class: "warn" }, `${s.malformedLines} malformed lines skipped`) : ""),
			),
			related.length ? h("div", { class: "related" }, related) : null,
			h(
				"div",
				{ class: "actions" },
				downloadButton(`/api/sessions/${s.key}/export`, "Export JSON"),
				downloadButton(`/api/sessions/${s.key}/raw`, "Raw JSONL"),
				h("button", { onclick: () => setAllTools(true) }, "Expand all tools"),
				h("button", { onclick: () => setAllTools(false) }, "Collapse all"),
				toggle("Thinking", "thinking"),
				toggle("System prompts", "system"),
				toggle("Abandoned branches", "offPath"),
				toggle("Only errors", "onlyErrors"),
			),
		),
		h("div", { class: "timeline" }, events.length ? events : h("p", { class: "muted" }, "No entries to show.")),
		renderCaptureExtras(),
	);

	if (entryId) {
		const target = document.getElementById(`e-${entryId}`);
		if (target) {
			if (target.tagName === "DETAILS") target.open = true;
			target.classList.add("highlight");
			target.scrollIntoView({ block: "center" });
			return;
		}
	}
	if (options.keepScroll) window.scrollTo(0, scrollY);
}

function setAllTools(open) {
	for (const el of document.querySelectorAll("details.tool")) el.open = open;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function kpi(label, value, bad, title) {
	return h("div", { class: `kpi${bad ? " bad" : ""}`, title }, h("div", { class: "value" }, value), h("div", { class: "label" }, label));
}

function bar(fraction, neutral) {
	const el = h("span", { class: `bar${neutral ? " neutral" : ""}` });
	el.style.width = `${Math.max(2, Math.round(Math.min(1, fraction) * 80))}px`;
	return el;
}

function table(headers, rows) {
	return h(
		"table",
		null,
		h("thead", null, h("tr", null, headers.map((x) => h("th", { class: x.num ? "num" : undefined }, x.label)))),
		h("tbody", null, rows),
	);
}

function panel(title, hint, content) {
	return h("section", { class: "panel" }, h("h2", null, title), hint ? h("p", { class: "hint" }, hint) : null, content);
}

async function renderInsights(token) {
	const a = await getJson(`/api/aggregate?${filterQuery()}`);
	if (token !== state.renderToken) return;
	state.version = a.version;
	if (a.sessions === 0) {
		$("app").replaceChildren(h("p", { class: "muted" }, "No sessions match the filters."));
		return;
	}
	const maxToolErrors = Math.max(1, ...a.tools.map((t) => t.errors));
	const maxGroup = Math.max(1, ...a.errorGroups.map((g) => g.count));

	const kpis = h(
		"div",
		{ class: "kpis" },
		kpi("sessions", a.sessions, false, `${a.subagentSessions} are subagent transcripts`),
		kpi("sessions with errors", `${a.sessionsWithErrors} (${fmtPct(a.sessionsWithErrors / a.sessions)})`, a.sessionsWithErrors > 0),
		kpi("tool calls", fmtNum(a.toolCalls)),
		kpi("tool error rate", fmtPct(a.toolErrorRate), a.toolErrorRate > 0.05, `${a.toolErrors} failed tool calls`),
		kpi("model errors", a.assistantErrors, a.assistantErrors > 0, "Assistant messages that ended with stopReason=error"),
		kpi("retries", a.retries, a.retries > 0, "Failed attempts that auto-retry removed from context"),
		kpi("aborted sessions", a.abortedSessions, a.abortedSessions > 0, `${a.abortedMessages} aborted responses`),
		kpi("tool calls without result", a.orphanToolCalls, a.orphanToolCalls > 0, "The run stopped while a tool was running"),
		kpi("avg user turns", a.avgUserMessages.toFixed(1)),
		kpi("avg tool calls / session", a.avgToolCalls.toFixed(1)),
		kpi("model latency p50 / p90", a.latency.p50Ms !== undefined ? `${fmtDur(a.latency.p50Ms)} / ${fmtDur(a.latency.p90Ms)}` : "n/a"),
		kpi("avg session duration", fmtDur(a.avgDurationMs)),
		kpi("compactions", a.compactions),
		kpi("tokens", fmtNum(a.tokens.total), false, `in ${a.tokens.input} · out ${a.tokens.output} · cache read ${a.tokens.cacheRead}`),
		kpi("cost", fmtCost(a.cost) || "$0"),
	);

	const tools = panel(
		"Tools by failures",
		"Calls and failures per tool. A high error rate points at a confusing schema, a weak description, or a fragile implementation.",
		table(
			[{ label: "Tool" }, { label: "Calls", num: true }, { label: "Errors", num: true }, { label: "Error rate" }, { label: "Avg time", num: true }, { label: "Max time", num: true }, { label: "Sessions", num: true }],
			a.tools.map((t) =>
				h(
					"tr",
					null,
					h("td", { class: "mono" }, t.name),
					h("td", { class: "num" }, t.calls),
					h("td", { class: `num${t.errors ? " err" : ""}` }, t.errors),
					h("td", null, t.errors ? bar(t.errors / maxToolErrors) : null, fmtPct(t.errorRate)),
					h("td", { class: "num" }, fmtDur(t.avgMs)),
					h("td", { class: "num" }, fmtDur(t.maxMs)),
					h("td", { class: "num" }, t.sessions),
				),
			),
		),
	);

	const errors = panel(
		"Errors grouped by message",
		"Paths, numbers, quoted strings, and ids are normalized so the same failure groups together. Click an example to open the entry.",
		a.errorGroups.length
			? table(
					[{ label: "Count", num: true }, { label: "Sessions", num: true }, { label: "Source" }, { label: "Signature" }, { label: "Examples" }],
					a.errorGroups.map((g) =>
						h(
							"tr",
							null,
							h("td", { class: "num" }, bar(g.count / maxGroup), g.count),
							h("td", { class: "num" }, g.sessions),
							h("td", null, g.kind === "tool" ? h("span", { class: "mono" }, g.tool || "tool") : h("span", { class: "badge error" }, "model")),
							h("td", { class: "sig", title: g.example }, g.signature),
							h(
								"td",
								null,
								g.examples.map((x, i) => [h("a", { href: sessionHref(x.key, x.entryId) }, String(i + 1)), " "]),
							),
						),
					),
				)
			: h("p", { class: "muted" }, "No errors recorded."),
	);

	const struggling = panel(
		"Sessions where the agent struggled",
		"Score = tool errors + 2 × model errors + retries + 2 × aborts + 2 × tool calls without result + long error streaks.",
		a.struggling.length
			? table(
					[{ label: "Score", num: true }, { label: "Session" }, { label: "Project" }, { label: "Model" }, { label: "Tool err", num: true }, { label: "Model err", num: true }, { label: "Streak", num: true }, { label: "Retries", num: true }, { label: "Started" }],
					a.struggling.map((s) =>
						h(
							"tr",
							{ class: "row", onclick: () => (location.hash = sessionHref(s.key)) },
							h("td", { class: "num err" }, s.score),
							h("td", { class: "first", title: s.firstMessage }, s.firstMessage),
							h("td", { title: s.cwd }, projectName(s.cwd)),
							h("td", null, s.primaryModel || ""),
							h("td", { class: "num" }, s.toolErrors),
							h("td", { class: "num" }, s.assistantErrors),
							h("td", { class: "num" }, s.maxToolErrorStreak),
							h("td", { class: "num" }, s.retries),
							h("td", null, fmtTime(s.startedAt)),
						),
					),
				)
			: h("p", { class: "muted" }, "No struggling sessions."),
	);

	const models = panel(
		"Models",
		"Grouped by each session's most used model.",
		table(
			[{ label: "Model" }, { label: "Sessions", num: true }, { label: "Calls", num: true }, { label: "Model err", num: true }, { label: "Tool calls", num: true }, { label: "Tool err", num: true }, { label: "Avg latency", num: true }, { label: "Tokens", num: true }, { label: "Cost", num: true }],
			a.models.map((m) =>
				h(
					"tr",
					null,
					h("td", null, m.model),
					h("td", { class: "num" }, m.sessions),
					h("td", { class: "num" }, m.assistantMessages),
					h("td", { class: `num${m.assistantErrors ? " err" : ""}` }, m.assistantErrors),
					h("td", { class: "num" }, m.toolCalls),
					h("td", { class: `num${m.toolErrors ? " err" : ""}` }, m.toolErrors),
					h("td", { class: "num" }, fmtDur(m.avgLatencyMs)),
					h("td", { class: "num" }, fmtNum(m.tokens)),
					h("td", { class: "num" }, fmtCost(m.cost)),
				),
			),
		),
	);

	const slow = panel(
		"Slowest tool calls",
		null,
		a.slowestToolCalls.length
			? table(
					[{ label: "Time", num: true }, { label: "Tool" }, { label: "Entry" }],
					a.slowestToolCalls.map((c) =>
						h("tr", null, h("td", { class: "num" }, fmtDur(c.ms)), h("td", { class: "mono" }, c.tool), h("td", null, h("a", { href: sessionHref(c.key, c.entryId) }, "open"))),
					),
				)
			: h("p", { class: "muted" }, "No timed tool calls."),
	);

	const stopTotal = Object.values(a.stopReasons).reduce((x, y) => x + y, 0) || 1;
	const stops = panel(
		"How model responses ended",
		null,
		table(
			[{ label: "Stop reason" }, { label: "Count", num: true }, { label: "Share" }],
			Object.entries(a.stopReasons)
				.sort((x, y) => y[1] - x[1])
				.map(([reason, count]) =>
					h(
						"tr",
						null,
						h("td", null, reason),
						h("td", { class: "num" }, count),
						h("td", null, bar(count / stopTotal, reason !== "error" && reason !== "aborted"), fmtPct(count / stopTotal)),
					),
				),
		),
	);

	const maxDay = Math.max(1, ...a.daily.map((d) => d.sessions));
	const daily = panel(
		"Daily activity",
		null,
		table(
			[{ label: "Day" }, { label: "Sessions" }, { label: "With errors", num: true }, { label: "Tool calls", num: true }, { label: "Tool errors", num: true }, { label: "Cost", num: true }],
			a.daily.map((d) =>
				h(
					"tr",
					null,
					h("td", null, d.day),
					h("td", null, bar(d.sessions / maxDay, true), d.sessions),
					h("td", { class: `num${d.sessionsWithErrors ? " err" : ""}` }, d.sessionsWithErrors),
					h("td", { class: "num" }, d.toolCalls),
					h("td", { class: "num" }, d.toolErrors),
					h("td", { class: "num" }, fmtCost(d.cost)),
				),
			),
		),
	);

	$("app").replaceChildren(kpis, h("div", { class: "grid-2" }, tools, errors), struggling, h("div", { class: "grid-2" }, models, slow), h("div", { class: "grid-2" }, stops, daily));
}


// ---------------------------------------------------------------------------
// Captured requests, network, and tool executions
// ---------------------------------------------------------------------------

function fmtBytes(n) {
	if (n === undefined || n === null) return "";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function indexCapture() {
	const capture = state.capture;
	state.captureByTimestamp = new Map();
	state.captureTools = new Map();
	state.linkedRequests = new Set();
	if (!capture) return;
	for (const request of capture.modelRequests) {
		if (request.messageTimestamp === undefined) continue;
		const list = state.captureByTimestamp.get(request.messageTimestamp) || [];
		list.push(request);
		state.captureByTimestamp.set(request.messageTimestamp, list);
	}
	for (const tool of capture.tools) state.captureTools.set(tool.toolCallId, tool);
}

function requestSummary(r) {
	return [
		`${r.provider}/${r.model}`,
		r.status !== undefined ? `HTTP ${r.status}` : null,
		fmtDur(r.durationMs),
		r.ttfbMs !== undefined ? `first byte ${fmtDur(r.ttfbMs)}` : null,
		r.payloadBytes !== undefined ? `payload ${fmtBytes(r.payloadBytes)} (~${fmtNum(r.payloadBytes / 4)} tokens)` : null,
		r.usage ? `input ${fmtNum(r.usage.input)} · output ${fmtNum(r.usage.output)} tokens` : null,
		`${r.eventCount} stream events`,
		r.http ? `${r.http} HTTP` : null,
		r.websockets ? `${r.websockets} WebSocket` : null,
		r.retries ? `${r.retries} retries` : null,
	]
		.filter(Boolean)
		.join(" · ");
}

function renderRequestLinks(e) {
	const requests = e.messageTimestamp !== undefined ? state.captureByTimestamp?.get(e.messageTimestamp) : undefined;
	if (!requests?.length) return null;
	return requests.map((r) => {
		state.linkedRequests.add(r.id);
		return renderRequestPanel(r);
	});
}

function renderRequestPanel(r) {
	const body = h("div", { class: "capture-body" }, h("p", { class: "muted" }, "Loading…"));
	let loaded = false;
	const el = h(
		"details",
		{ class: `capture${r.httpErrors || r.errorMessage ? " error" : ""}` },
		h("summary", null, h("span", { class: "capture-label" }, "raw request"), " ", h("span", { class: "muted" }, requestSummary(r))),
		body,
	);
	const load = async () => {
		if (loaded) return;
		loaded = true;
		try {
			const detail = await getJson(`/api/capture/model/${encodeURIComponent(r.id)}`);
			body.replaceChildren(renderModelRequestDetail(detail));
		} catch (error) {
			body.replaceChildren(h("p", { class: "err" }, `Failed to load: ${error.message}`));
		}
	};
	el.addEventListener("toggle", () => {
		if (el.open) void load();
	});
	trackOpen(el, `request:${r.id}`);
	if (el.open) void load();
	return el;
}

function blobLink(fileKey, blob, label) {
	return blob ? downloadButton(`/api/capture/blob/${fileKey}/${encodeURIComponent(blob)}`, label || "download full", "link") : null;
}

function jsonPre(value) {
	return h("pre", null, JSON.stringify(value, null, 2));
}

function previewItem(item) {
	if (!item || typeof item !== "object") return oneLine(JSON.stringify(item), 140);
	const role = item.role || item.type || "";
	let text = "";
	if (typeof item.content === "string") text = item.content;
	else if (Array.isArray(item.content)) text = item.content.map((c) => (c && (c.text || c.type)) || "").join(" ");
	else if (item.name) text = item.name;
	else if (item.text) text = item.text;
	return `${role}${role ? ": " : ""}${oneLine(text || JSON.stringify(item), 140)}`;
}

/** Payload as a tree of collapsible top-level fields; arrays list one collapsible item each. */
function renderPayload(payload) {
	if (payload.json === undefined) {
		return payload.text !== undefined ? h("pre", null, payload.text) : h("p", { class: "muted" }, "Payload not captured (the provider did not report it).");
	}
	const json = payload.json;
	if (!json || typeof json !== "object" || Array.isArray(json)) return jsonPre(json);
	return Object.entries(json).map(([key, value]) => {
		if (Array.isArray(value)) {
			return h(
				"details",
				{ class: "field" },
				h("summary", null, h("span", { class: "mono" }, key), h("span", { class: "muted" }, ` [${value.length}] ${fmtBytes(JSON.stringify(value).length)}`)),
				value.map((item, index) =>
					h("details", { class: "item" }, h("summary", { class: "mono" }, `${index}: ${previewItem(item)}`), jsonPre(item)),
				),
			);
		}
		if (value && typeof value === "object") {
			return h("details", { class: "field" }, h("summary", null, h("span", { class: "mono" }, key), h("span", { class: "muted" }, ` ${fmtBytes(JSON.stringify(value).length)}`)), jsonPre(value));
		}
		const text = typeof value === "string" ? value : JSON.stringify(value);
		if (text.length > 160) {
			return h("details", { class: "field" }, h("summary", null, h("span", { class: "mono" }, key), h("span", { class: "muted" }, ` ${fmtBytes(text.length)}: ${oneLine(text, 100)}`)), h("pre", null, text));
		}
		return h("div", { class: "field mono" }, `${key}: ${text}`);
	});
}

function renderDiff(previous) {
	if (!previous) return h("p", { class: "muted" }, "First request of the session.");
	const { changed, unchanged } = previous.diff;
	const items = changed.map((c) => {
		if (c.kind === "array") {
			return h(
				"details",
				{ class: "field", open: true },
				h("summary", null, h("span", { class: "mono" }, c.key), ` +${c.length - c.commonPrefix} items`, c.removed ? h("span", { class: "warn" }, `, ${c.removed} replaced or removed`) : null, h("span", { class: "muted" }, ` (kept ${c.commonPrefix} of ${c.previousLength}, now ${c.length})`)),
				(c.added || []).map((item, index) => h("details", { class: "item" }, h("summary", { class: "mono" }, `${c.commonPrefix + index}: ${previewItem(item)}`), jsonPre(item))),
				c.addedOmitted ? h("div", { class: "muted" }, `${c.addedOmitted} more`) : null,
			);
		}
		return h(
			"details",
			{ class: "field" },
			h("summary", null, h("span", { class: "mono" }, c.key), ` ${c.kind === "value" ? "changed" : c.kind}`),
			c.before !== undefined ? [h("div", { class: "section-label" }, "before"), h("pre", null, c.before)] : null,
			c.after !== undefined ? [h("div", { class: "section-label" }, "after"), h("pre", null, c.after)] : null,
		);
	});
	return h("div", null, items.length ? items : h("p", { class: "muted" }, "Payload identical to the previous request."), unchanged.length ? h("div", { class: "muted" }, `unchanged: ${unchanged.join(", ")}`) : null);
}

function headersTable(headers) {
	if (!headers) return null;
	return h(
		"table",
		{ class: "headers" },
		h(
			"tbody",
			null,
			Object.entries(headers).map(([name, value]) => h("tr", null, h("td", { class: "mono" }, name), h("td", { class: "mono" }, Array.isArray(value) ? value.join("\n") : value))),
		),
	);
}

function waterfall(timing) {
	const total = timing.totalMs || 0;
	if (!total) return null;
	const connect = timing.connectMs || 0;
	const send = Math.max(0, (timing.sendMs ?? connect) - connect);
	const wait = Math.max(0, (timing.ttfbMs ?? timing.sendMs ?? 0) - (timing.sendMs ?? connect));
	const receive = Math.max(0, total - (timing.ttfbMs ?? total));
	const segment = (cls, ms, label) => {
		const el = h("span", { class: `seg ${cls}`, title: `${label}: ${fmtDur(ms)}` });
		el.style.width = `${Math.max(ms > 0 ? 1 : 0, (ms / total) * 100)}%`;
		return el;
	};
	return h(
		"div",
		null,
		h("div", { class: "waterfall" }, segment("connect", connect, "connect (DNS+TCP+TLS)"), segment("send", send, "queue and send"), segment("wait", wait, "waiting for first byte"), segment("receive", receive, "receiving")),
		h("div", { class: "muted legend" }, `connect ${timing.reusedConnection ? "reused" : fmtDur(connect)} · send ${fmtDur(send)} · wait ${fmtDur(wait)} · receive ${fmtDur(receive)} · total ${fmtDur(total)}`),
	);
}

function networkRows(n) {
	if (!n) return null;
	const rows = [
		["remote", n.remoteAddress ? `${n.remoteAddress}${n.remotePort ? `:${n.remotePort}` : ""}${n.remoteFamily ? ` (${n.remoteFamily})` : ""}` : ""],
		["local", n.localAddress ? `${n.localAddress}${n.localPort ? `:${n.localPort}` : ""}` : ""],
		["HTTP", n.httpVersion || ""],
		["TLS", [n.tlsProtocol, n.cipher, n.alpnProtocol ? `ALPN ${n.alpnProtocol}` : "", n.servername ? `SNI ${n.servername}` : ""].filter(Boolean).join(" · ")],
		["proxy", n.proxy || ""],
		["connect", n.connectMs !== undefined ? fmtDur(n.connectMs) : ""],
	].filter(([, v]) => v);
	return h("dl", { class: "meta" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", { class: "mono" }, v)]));
}

function bodyBlock(label, body, fileKey) {
	if (!body) return null;
	const note = [fmtBytes(body.bytes), body.wireBytes !== undefined && body.wireBytes !== body.bytes ? `${fmtBytes(body.wireBytes)} on the wire (${body.contentEncoding})` : null, body.truncated ? "cut at capture limit" : null, body.note || null].filter(Boolean).join(" · ");
	let content;
	if (body.sameAs === "payload") content = h("div", { class: "muted" }, "Same bytes as the payload above.");
	else if (body.binary) content = h("div", { class: "muted" }, "Binary body; only the size is kept.");
	else content = [h("pre", null, body.text ?? ""), body.cut ? h("div", { class: "truncated" }, `[${body.cut} more characters] `, blobLink(fileKey, body.blob)) : null];
	return h("details", { class: "field" }, h("summary", null, label, h("span", { class: "muted" }, ` ${note}`), " ", body.blob ? blobLink(fileKey, body.blob, "download") : null), content);
}

function renderHttp(r) {
	const error = r.error || (r.status !== undefined && r.status >= 400);
	return h(
		"div",
		{ class: `http-record${error ? " error" : ""}` },
		h("div", { class: "mono" }, h("b", null, `${r.method} `), r.url, " ", r.status !== undefined ? h("span", { class: `badge${r.status >= 400 ? " error" : " ok"}` }, `${r.status}`) : null, r.error ? h("span", { class: "badge error" }, r.error) : null, r.aborted ? h("span", { class: "badge warn" }, "aborted") : null),
		h("div", { class: "muted" }, `${fmtTime(r.t)} · sent ${fmtBytes(r.bytesOut)} · received ${fmtBytes(r.bytesIn)}`),
		waterfall(r.timing),
		networkRows(r.network),
		h("details", { class: "field" }, h("summary", null, "request headers"), headersTable(r.requestHeaders)),
		bodyBlock("request body", r.requestBody, r.fileKey),
		h("details", { class: "field" }, h("summary", null, "response headers"), headersTable(r.responseHeaders)),
		bodyBlock("raw response", r.responseBody, r.fileKey),
	);
}

function framesPre(frames) {
	const lines = frames.items.map((f) => `${f.t ? new Date(f.t).toISOString().slice(11, 23) : ""} ${typeof f.data === "string" ? f.data : JSON.stringify(f)}`);
	return [h("pre", null, lines.join("\n")), frames.total > frames.items.length ? h("div", { class: "truncated" }, `${frames.total - frames.items.length} more frames`) : null];
}

function renderWebSocket(w) {
	return h(
		"div",
		{ class: "http-record" },
		h("div", { class: "mono" }, h("b", null, "WS "), w.url, w.handshake?.status ? h("span", { class: "badge ok" }, `${w.handshake.status}`) : null, w.closeCode !== undefined ? h("span", { class: "badge" }, `closed ${w.closeCode}`) : null),
		h("div", { class: "muted" }, `${fmtTime(w.t)} · ${w.framesSent} frames sent (${fmtBytes(w.bytesOut)}) · ${w.framesReceived} received (${fmtBytes(w.bytesIn)}) · ${fmtDur(w.endedAt - w.t)}`),
		networkRows(w.network),
		w.handshake?.requestHeaders ? h("details", { class: "field" }, h("summary", null, "handshake request headers"), headersTable(w.handshake.requestHeaders)) : null,
		w.handshake?.headers ? h("details", { class: "field" }, h("summary", null, "handshake response headers"), headersTable(w.handshake.headers)) : null,
		h("details", { class: "field" }, h("summary", null, `sent frames (${w.framesSent})`), framesPre(w.sentFrames), blobLink(w.fileKey, w.sent?.blob)),
		h("details", { class: "field" }, h("summary", null, `received frames (${w.framesReceived})`), framesPre(w.receivedFrames), blobLink(w.fileKey, w.received?.blob)),
	);
}

function renderModelRequestDetail(d) {
	const r = d.record;
	const events = d.events.items.map((e) => JSON.stringify(e.data ?? e)).join("\n");
	return h(
		"div",
		null,
		h(
			"dl",
			{ class: "meta" },
			metaRow("Request", `${r.id} · ${fmtTime(r.t)} · ${r.api}`),
			metaRow("Timing", `payload built after ${r.payloadAt ? fmtDur(r.payloadAt - r.t) : "?"} · first byte ${fmtDur(r.ttfbMs)} · total ${fmtDur(r.durationMs)}`),
			metaRow("Payload", d.payload.bytes !== undefined ? `${fmtBytes(d.payload.bytes)} (~${fmtNum(d.payload.bytes / 4)} tokens by size)${r.usage ? ` · provider counted ${fmtNum(r.usage.input + r.usage.cacheRead + r.usage.cacheWrite)} input tokens (${fmtNum(r.usage.cacheRead)} cached)` : ""}` : ""),
			metaRow("Result", [r.stopReason, r.responseId, r.responseModel].filter(Boolean).join(" · ")),
			metaRow("Error", r.errorMessage ? h("span", { class: "err" }, r.errorMessage) : ""),
		),
		h("details", { class: "section", open: true }, h("summary", null, "What changed since the previous request"), renderDiff(d.previous)),
		h("details", { class: "section" }, h("summary", null, `Payload sent `, h("span", { class: "muted" }, fmtBytes(d.payload.bytes)), " ", blobLink(d.fileKey, d.payload.blob, "download")), renderPayload(d.payload)),
		h("details", { class: "section" }, h("summary", null, `Stream events (${d.events.total})`, " ", blobLink(d.fileKey, d.eventsBlob, "download")), h("pre", null, events), d.events.total > d.events.items.length ? h("div", { class: "truncated" }, `${d.events.total - d.events.items.length} more events`) : null),
		h("details", { class: "section" }, h("summary", null, "Assembled message"), d.message !== undefined ? jsonPre(d.message) : h("p", { class: "muted" }, "Not captured.")),
		r.response ? h("details", { class: "section" }, h("summary", null, `Response headers (HTTP ${r.response.status})`), headersTable(r.response.headers)) : null,
		h(
			"details",
			{ class: "section", open: true },
			h("summary", null, `Network (${d.http.length} HTTP, ${d.websockets.length} WebSocket)`),
			d.http.length || d.websockets.length ? [d.http.map(renderHttp), d.websockets.map(renderWebSocket)] : h("p", { class: "muted" }, "No network activity was captured for this request (Bun binary, or a transport outside fetch)."),
		),
	);
}

function renderCapturedTool(t) {
	const body = h("div", null);
	let loaded = false;
	const el = h(
		"details",
		{ class: "field" },
		h("summary", { class: "muted" }, `captured: ${fmtDur(t.durationMs)}${t.exitCode !== undefined ? ` · exit ${t.exitCode}` : ""}${t.fullOutputBytes !== undefined ? ` · full output ${fmtBytes(t.fullOutputBytes)}` : ""}${t.cwd ? ` · cwd ${t.cwd}` : ""}`),
		body,
	);
	el.addEventListener("toggle", async () => {
		if (!el.open || loaded) return;
		loaded = true;
		try {
			const d = await getJson(`/api/capture/tool/${t.fileKey}/${encodeURIComponent(t.id)}`);
			body.replaceChildren(
				bodyBlock("exact arguments", d.args, d.fileKey),
				bodyBlock("what the model received", d.content, d.fileKey),
				d.fullOutput ? bodyBlock(`full output (${d.fullOutputPath})`, d.fullOutput, d.fileKey) : null,
				bodyBlock("details", d.details, d.fileKey),
			);
		} catch (error) {
			body.replaceChildren(h("p", { class: "err" }, error.message));
		}
	});
	return el;
}

function renderCaptureExtras() {
	const capture = state.capture;
	if (!capture) return null;
	const unlinked = capture.modelRequests.filter((r) => !state.linkedRequests.has(r.id));
	const parts = [];
	if (!capture.files.length) {
		parts.push(h("p", { class: "muted" }, "No captured requests for this session. Capture records sessions run after it was enabled (setting traces.enabled)."));
	}
	if (unlinked.length) {
		parts.push(h("h2", null, `Requests not linked to an entry (${unlinked.length})`), h("p", { class: "hint" }, "Compaction and summaries, failed attempts that were not saved, or requests of entries hidden by filters."), unlinked.map(renderRequestPanel));
	}
	if (capture.otherActivity.length) {
		parts.push(h("h2", null, `Other network activity of this process (${capture.otherActivity.length})`), h("p", { class: "hint" }, "Requests outside model calls while this session ran: MCP, web fetch, OAuth, model lists."), networkTable(capture.otherActivity));
	}
	return parts.length ? h("section", { class: "panel capture-extras" }, parts) : null;
}

function networkTable(items) {
	return h(
		"table",
		null,
		h("thead", null, h("tr", null, ["Time", "Session", "Provider", "Method", "Host", "Path", "Status", "Time", "TTFB", "Out", "In", "Remote"].map((label, i) => h("th", { class: i >= 7 && i <= 10 ? "num" : undefined }, label)))),
		h(
			"tbody",
			null,
			items.map((item) => {
				let path = item.url;
				try {
					const u = new URL(item.url);
					path = `${u.pathname}${u.search}`;
				} catch {}
				const detail = h("tr", { class: "detail-row" }, h("td", { colspan: "12" }));
				detail.hidden = true;
				let loaded = false;
				const row = h(
					"tr",
					{
						class: "row",
						onclick: async () => {
							detail.hidden = !detail.hidden;
							if (loaded || detail.hidden) return;
							loaded = true;
							try {
								const kind = item.kind === "websocket" ? "ws" : "http";
								const d = await getJson(`/api/capture/${kind}/${item.fileKey}/${encodeURIComponent(item.id)}`);
								detail.firstChild.replaceChildren(item.kind === "websocket" ? renderWebSocket(d) : renderHttp(d), item.modelRequestId ? h("div", null, "Part of model request ", h("span", { class: "mono" }, item.modelRequestId)) : null);
							} catch (error) {
								detail.firstChild.replaceChildren(h("span", { class: "err" }, error.message));
							}
						},
					},
					h("td", null, fmtTime(item.t)),
					h("td", null, item.sessionKey ? h("a", { href: sessionHref(item.sessionKey), onclick: (event) => event.stopPropagation() }, "session") : h("span", { class: "muted" }, item.sessionId ? "session" : "process")),
					h("td", null, item.provider ? `${item.provider}${item.model ? `/${item.model}` : ""}` : ""),
					h("td", { class: "mono" }, item.method),
					h("td", { class: "mono" }, item.host),
					h("td", { class: "mono first", title: item.url }, oneLine(path, 80)),
					h("td", null, item.error ? h("span", { class: "badge error", title: item.error }, "error") : item.status !== undefined ? h("span", { class: `badge${item.status >= 400 ? " error" : " ok"}` }, item.status) : ""),
					h("td", { class: "num" }, fmtDur(item.durationMs)),
					h("td", { class: "num" }, fmtDur(item.ttfbMs)),
					h("td", { class: "num" }, fmtBytes(item.bytesOut)),
					h("td", { class: "num" }, fmtBytes(item.bytesIn)),
					h("td", { class: "mono" }, item.remoteAddress ? `${item.remoteAddress}${item.tlsProtocol ? ` ${item.tlsProtocol}` : ""}` : ""),
				);
				return [row, detail];
			}),
		),
	);
}

const networkFilter = { q: "", host: "", status: "", provider: "", errors: false, slowMs: "" };

async function renderNetwork(token) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(networkFilter)) {
		if (value === true) params.set(key, "1");
		else if (value) params.set(key, String(value));
	}
	const f = readFilter();
	if (f.from) params.set("from", f.from);
	if (f.to) params.set("to", f.to);
	if (f.q && !networkFilter.q) params.set("q", f.q);
	const [data, facets] = await Promise.all([getJson(`/api/network?${params}`), getJson("/api/network/facets")]);
	if (token !== state.renderToken) return;
	state.version = data.version;
	const select = (key, options, label) => {
		const el = h("select", { onchange: (event) => { networkFilter[key] = event.target.value; render(); } }, h("option", { value: "" }, label), options.map((o) => h("option", { value: o.value }, `${o.value} (${o.count})`)));
		el.value = networkFilter[key];
		return el;
	};
	const statusSelect = h("select", { onchange: (event) => { networkFilter.status = event.target.value; render(); } }, [["", "Any status"], ["2xx", "2xx"], ["3xx", "3xx"], ["4xx", "4xx"], ["5xx", "5xx"], ["error", "Errors"], ["none", "No response"]].map(([v, l]) => h("option", { value: v }, l)));
	statusSelect.value = networkFilter.status;
	const slow = h("input", { type: "number", min: "0", step: "100", placeholder: "slower than ms", value: networkFilter.slowMs, onchange: (event) => { networkFilter.slowMs = event.target.value; render(); } });
	const q = h("input", { type: "search", placeholder: "URL, IP, error", value: networkFilter.q, onchange: (event) => { networkFilter.q = event.target.value.trim(); render(); } });
	const errors = h("input", { type: "checkbox", checked: networkFilter.errors, onchange: (event) => { networkFilter.errors = event.target.checked; render(); } });
	$("app").replaceChildren(
		h("div", { class: "actions" }, q, select("host", facets.hosts, "All hosts"), select("provider", facets.providers, "All providers"), statusSelect, slow, h("label", { class: "check" }, errors, " Errors only")),
		h("p", { class: "summary-line" }, `${data.total} requests`, data.total > data.items.length ? ` (showing ${data.items.length})` : "", ". Click a row for headers, bodies, timings, and the remote address."),
		data.total ? networkTable(data.items) : h("p", { class: "muted" }, "No captured network activity. Capture starts with the next akramcode run (setting traces.enabled, on by default)."),
	);
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

let refreshTimer;
function scheduleRefresh() {
	clearTimeout(refreshTimer);
	refreshTimer = setTimeout(async () => {
		try {
			await loadFacets();
		} catch {}
		const route = parseRoute();
		if (route.name === "session") {
			// Keep expanded tool calls and the scroll position while a running session grows.
			const token = ++state.renderToken;
			try {
				const [data, capture] = await Promise.all([
					getJson(`/api/sessions/${route.key}`),
					getJson(`/api/sessions/${route.key}/capture`).catch(() => undefined),
				]);
				if (token !== state.renderToken) return;
				const captureChanged = JSON.stringify(capture?.modelRequests?.length) !== JSON.stringify(state.capture?.modelRequests?.length) || capture?.tools?.length !== state.capture?.tools?.length;
				state.capture = capture;
				const changed = captureChanged || !state.detail || data.summary.mtimeMs !== state.detail.summary.mtimeMs || data.summary.sizeBytes !== state.detail.summary.sizeBytes;
				state.detail = data;
				state.version = data.version;
				if (changed) renderDetail(undefined, { keepScroll: true });
			} catch {}
		} else {
			render();
		}
	}, 300);
}

/**
 * Live updates over a streamed fetch of /api/events (server-sent events format). EventSource
 * cannot send an Authorization header, so the stream is read and parsed here.
 */
function connectLive() {
	const live = $("live");
	const setStatus = (text, cls) => {
		live.textContent = text;
		live.className = `live ${cls}`;
	};
	const connect = async () => {
		try {
			const res = await fetch("/api/events", { headers: authHeaders({ Accept: "text/event-stream" }) });
			if (res.status === 401) {
				setStatus("not authorized", "off");
				return;
			}
			if (!res.ok || !res.body) throw new Error(String(res.status));
			setStatus("live", "on");
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				let boundary = buffer.indexOf("\n\n");
				while (boundary !== -1) {
					const block = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = block
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trim())
						.join("\n");
					if (data && /^event: version$/m.test(block)) {
						try {
							if (JSON.parse(data).version !== state.version) scheduleRefresh();
						} catch {}
					}
					boundary = buffer.indexOf("\n\n");
				}
				if (buffer.length > 1_000_000) buffer = "";
			}
		} catch {}
		setStatus("reconnecting", "off");
		setTimeout(connect, 3000);
	};
	void connect();
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function init() {
	takeTokenFromHash();
	restoreFilter();
	$("f-export").addEventListener("click", () => void download(`/api/export?${filterQuery()}`));
	for (const id of ["f-q", "f-project", "f-model", "f-subagents", "f-errors", "f-from", "f-to"]) {
		$(id).addEventListener(id === "f-q" ? "input" : "change", onFilterChange);
	}
	$("f-reset").addEventListener("click", () => {
		$("f-q").value = "";
		$("f-project").value = "";
		$("f-model").value = "";
		$("f-subagents").value = "include";
		$("f-errors").checked = false;
		$("f-from").value = "";
		$("f-to").value = "";
		onFilterChange();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
			event.preventDefault();
			$("f-q").focus();
		}
	});
	window.addEventListener("hashchange", () => render());
	saveFilter();
	loadFacets()
		.catch(() => {})
		.finally(() => {
			saveFilter();
			render();
		});
	connectLive();
}

init();
