// akramcode remote UI. Plain browser JavaScript, no dependencies. All session content is inserted
// as text (never as HTML), so transcripts cannot inject markup or scripts.
"use strict";

const $ = (id) => document.getElementById(id);

function h(tag, props, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props || {})) {
		if (key === "class") el.className = value;
		else el.setAttribute(key, value);
	}
	for (const child of children) {
		if (child === undefined || child === null || child === false) continue;
		el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return el;
}

// The token comes in the URL fragment (#token=...), which browsers never send to servers. It is
// kept in sessionStorage for this tab, removed from the address bar, and sent as a Bearer header.
const TOKEN_STORAGE_KEY = "akramcode-remote-token";

function takeTokenFromHash() {
	const match = /^#token=([0-9a-f]{64})$/.exec(location.hash);
	if (!match) return;
	try {
		sessionStorage.setItem(TOKEN_STORAGE_KEY, match[1]);
	} catch {}
	history.replaceState(null, "", location.pathname);
}

function authHeaders(extra) {
	let token = "";
	try {
		token = sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
	} catch {}
	return { ...extra, Authorization: `Bearer ${token}` };
}

class AuthError extends Error {}

async function api(method, path, body) {
	const res = await fetch(path, {
		method,
		headers: authHeaders(body ? { "Content-Type": "application/json" } : {}),
		body: body ? JSON.stringify(body) : undefined,
	});
	if (res.status === 401) throw new AuthError();
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
	return res;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const toolElements = new Map();
let partialEl;

function setStatus(text, busy) {
	$("status").textContent = text;
	$("status").classList.toggle("busy", !!busy);
	$("stop").hidden = !busy;
}

function nearBottom() {
	const log = $("log");
	return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
}

function scrollToBottom() {
	$("log").scrollTop = $("log").scrollHeight;
}

function renderAssistant(message) {
	const parts = [];
	if (message.thinking) parts.push(h("div", { class: "msg thinking" }, message.thinking));
	if (message.text) parts.push(h("div", { class: "msg" }, message.text));
	for (const tool of message.tools) {
		const el = h("details", { class: "tool" }, h("summary", {}, `${tool.name} ${tool.args}`), h("pre", {}, tool.args));
		toolElements.set(tool.id, el);
		parts.push(el);
	}
	if (message.error) parts.push(h("div", { class: "msg error" }, message.error));
	return parts;
}

function addMessage(message) {
	if (message.role === "user") {
		$("log").appendChild(h("div", { class: "msg user" }, message.text));
	} else if (message.role === "assistant") {
		for (const part of renderAssistant(message)) $("log").appendChild(part);
	} else if (message.role === "tool") {
		const result = h("pre", { class: message.isError ? "error" : "" }, message.text || "(no output)");
		const el = toolElements.get(message.toolCallId);
		if (el) {
			el.appendChild(result);
			if (message.isError) el.querySelector("summary").classList.add("error");
		} else {
			$("log").appendChild(h("details", { class: "tool" }, h("summary", {}, message.name), result));
		}
	}
}

function clearPartial() {
	partialEl?.remove();
	partialEl = undefined;
}

function handleEvent(event) {
	const stick = nearBottom();
	if (event.type === "status") {
		setStatus(event.busy ? "working" : "idle", event.busy);
	} else if (event.type === "partial") {
		clearPartial();
		partialEl = h("div", {}, ...renderAssistant({ ...event.message, tools: [] }));
		$("log").appendChild(partialEl);
	} else if (event.type === "message") {
		if (event.message.role === "assistant") clearPartial();
		addMessage(event.message);
	} else if (event.type === "reset") {
		void loadState();
		return;
	}
	if (stick) scrollToBottom();
}

async function loadState() {
	const state = await (await api("GET", "api/state")).json();
	$("title").textContent = [state.name, state.cwd, state.model].filter(Boolean).join(" · ") || "akramcode";
	document.title = state.name ? `${state.name} - akramcode` : "akramcode remote";
	toolElements.clear();
	clearPartial();
	$("log").replaceChildren();
	for (const message of state.messages) addMessage(message);
	setStatus(state.busy ? "working" : "idle", state.busy);
	scrollToBottom();
}

// ---------------------------------------------------------------------------
// Live updates: server-sent events read with fetch, since EventSource cannot send headers.
// ---------------------------------------------------------------------------

async function streamEvents() {
	const res = await api("GET", "api/events");
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	// Events that arrive while the snapshot loads are applied after it.
	let queued = [];
	const loading = loadState().finally(() => {
		for (const event of queued) handleEvent(event);
		queued = undefined;
	});
	let buffer = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let end = buffer.indexOf("\n\n");
		while (end !== -1) {
			const data = buffer
				.slice(0, end)
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => line.slice(6))
				.join("\n");
			buffer = buffer.slice(end + 2);
			if (data) {
				const event = JSON.parse(data);
				if (queued) queued.push(event);
				else handleEvent(event);
			}
			end = buffer.indexOf("\n\n");
		}
	}
	await loading;
}

async function connect() {
	while (true) {
		try {
			await streamEvents();
		} catch (error) {
			if (error instanceof AuthError) {
				setStatus("not authorized", false);
				$("log").replaceChildren(
					h("p", { class: "msg error" }, "Not authorized. Open the full URL printed by /remote. Each run uses a new token."),
				);
				return;
			}
		}
		setStatus("reconnecting", false);
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function sendPrompt() {
	const text = $("input").value.trim();
	if (!text) return;
	$("send").disabled = true;
	try {
		await api("POST", "api/prompt", { text });
		$("input").value = "";
	} catch (error) {
		setStatus(error instanceof AuthError ? "not authorized" : `send failed: ${error.message}`, false);
	} finally {
		$("send").disabled = false;
		$("input").focus();
	}
}

$("composer").addEventListener("submit", (event) => {
	event.preventDefault();
	void sendPrompt();
});

$("input").addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void sendPrompt();
	}
});

$("stop").addEventListener("click", () => {
	void api("POST", "api/abort").catch(() => {});
});

takeTokenFromHash();
void connect();
