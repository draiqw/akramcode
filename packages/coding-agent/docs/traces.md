# Traces

`akramcode traces` opens a local web UI with every stored session and everything AkramCode captured while running them, so you can study runs and find where the agent struggles. It shows which tools fail, which errors repeat, and where runs get aborted or retried. It also shows the exact payload each model call sent, the raw stream that came back, and the network details of every request.

```sh
akramcode traces            # prints http://127.0.0.1:<port>/?token=<token>
akramcode traces --open     # also opens the browser
akramcode traces --port 4800
```

The server binds to `127.0.0.1` only, accepts only `GET` requests with a loopback `Host` header, and never writes to session or trace files. Press Ctrl+C to stop it.

## Access token

Captured traces contain full model payloads, so the server requires a token. Other users on the same machine can also reach `127.0.0.1`. Each run generates a new random token (32 bytes) and prints it in the URL.

- Opening the printed URL stores the token in an `HttpOnly`, `SameSite=Strict` cookie and redirects to the same page without the token, so it does not stay in the address bar or history.
- Every request without a valid token or cookie gets `401`. This covers the page, its scripts and styles, the API, and the live-update stream.
- Scripts can send the token as `Authorization: Bearer <token>` or as `?token=<token>` on `/api/` URLs.

The token stops working when the server stops.

## Options

| Option | Description |
| --- | --- |
| `--port <port>` | Port to listen on. Default: a free port |
| `--open` | Open the URL with the token in the default browser |
| `--session-dir <dir>` | Also read sessions from this directory. Repeatable |
| `--poll <ms>` | Re-scan interval for live updates. Default `2000`; `0` disables live updates |

## What it reads

Sessions are the JSONL files described in [Session File Format](session-format.md):

- `~/.akramcode/agent/sessions/` for all projects, or `$AKRAMCODE_CODING_AGENT_DIR/sessions/` when that variable is set.
- `AKRAMCODE_CODING_AGENT_SESSION_DIR`, the `sessionDir` setting, and `--session-dir` directories.
- Subagent transcripts in `<session>.subagents/` next to the parent session. They are linked to their parent and to the `agent` tool call that started them. See [Subagents](subagents.md).

Captured traces are read from `~/.akramcode/agent/traces/` (see [Capture](#capture)).

Background task output files (`akramcode-tasks-*` in the temp directory) are not indexed; they are temporary and are deleted when the session ends. Their task notifications are stored in the session and show in the timeline.

Malformed lines are skipped and counted per session, so a file that is being written or was cut short still loads. Session files are parsed as streams and cached by size and modification time; trace files are append-only, so a re-scan reads only new bytes.

## Capture

While AkramCode runs, it records what goes to the model and what comes back, plus the network activity and tool executions of the process. Capture is on by default and starts with the first command after an update; sessions run before that have no captured data.

For each model request:

- Provider, API, model, timestamps, and the session it belongs to. The request links to its assistant entry through the message timestamp.
- The final payload as passed to the provider, after extension hooks: system prompt, messages, tools, and parameters.
- Response status and headers, the raw provider stream events, and the assembled message with usage, stop reason, and errors.
- Time to the first response byte and the total time.

For each HTTP request of the process, whether to a model, an MCP server, a web fetch, an OAuth token refresh, or a model list:

- Method, URL, request and response headers, the request body as sent, and the raw response body. Compressed responses are decompressed, and SSE streams are kept as received.
- Status, errors and aborts, bytes in and out, and the time to connect, send, first byte, and total.
- Network details: remote IP and port, local address, HTTP version, TLS protocol, cipher, ALPN, and the proxy if one was used.
- Requests made during a model request are linked to it. Several HTTP requests for one model request are provider-level retries.

For WebSocket transports (for example `openai-codex`), every frame sent and received is kept, grouped per model request, with the handshake headers and remote address.

For each tool execution:

- The exact arguments, the text the model received, the tool details, exit code, duration, and working directory.
- When a tool cut its output for the model and saved the full output to a file (`bash` does this), the full output is copied into the trace.

Agent-level retries are separate model requests, each linked to its own failed or successful assistant entry.

### Storage and retention

Each process appends to JSONL files under `~/.akramcode/agent/traces/`: `sessions/<session id>/<start>_<pid>.jsonl` for a session and `process/<start>_<pid>.jsonl` for activity outside any session. Bodies over 16 KB are stored in a `.blobs` directory next to the file. Files and directories are created readable only by the owner.

Every 30 minutes, and 10 seconds after start, AkramCode deletes trace files older than `traces.maxAgeDays` and then the oldest files until the directory fits `traces.maxTotalSizeMb`. Files the current process is writing are kept. See [Settings](settings.md#traces).

### Secrets

Secrets are redacted before anything is written:

- Values of `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, API key headers, and other headers named like keys, tokens, secrets, or signatures. Header names are kept.
- URL credentials and query parameters such as `key`, `api_key`, `access_token`, `code`, and `signature`.
- Known key formats in any body, tool argument, or tool output: OpenAI, Anthropic, Google, GitHub, Slack, AWS, GitLab, Hugging Face, Groq, xAI, and npm keys, JWTs, and private key blocks.
- JSON and form fields such as `access_token`, `refresh_token`, `client_secret`, and `password`.
- Secret values seen in credential headers are also removed wherever they reappear.

Redaction matches known formats. A secret in an unrecognized format inside a prompt or tool output can still be stored. Turn capture off for sessions that handle such data.

### Not captured

- Network activity of child processes, such as commands run by `bash`, and of tools that run in a sandbox.
- Requests made with `node:http` or `node:https` directly instead of `fetch`, for example by some extensions.
- HTTP and WebSocket details in the standalone Bun binary, which does not report undici diagnostics channels. Model payloads, stream events, responses, and tool executions are still captured there. Outgoing WebSocket frames are captured; incoming ones are captured once the socket has sent a frame.
- Separate DNS, TCP, and TLS times. The connect time covers all three. Through a proxy, the remote address is the proxy's.
- Environment changes made by tools.
- A request that is still running when the process is killed.

Bodies larger than `traces.maxBodyMb` are cut and marked.

Overhead: capture adds a few milliseconds per model request for serializing, redacting, and writing. Measured locally, it added about 4 ms to a request with a 1 MB body and a 250 KB streamed response. Memory grows by the size of the request and response while a request runs.

## Views

**Sessions** lists sessions across all projects: last activity, project, first message or name, model, user turns, tool calls, errors, tokens, cost, duration, and how the run ended (`stop`, `error`, `aborted`, or `in tool` when it stopped while a tool was running). Filter by text, project, model, errors, date range, and whether to include subagent transcripts. Text search covers user and assistant text, tool call arguments, error messages, cwd, and model names.

**Session detail** shows the timeline of entries in file order with the time since the previous entry:

- User messages, assistant text and thinking, and model, latency, token usage, and cost per model call.
- Every tool call with its arguments and result, collapsible. Failed tool calls and model errors are highlighted. With capture, a tool call also shows its exact arguments, the full output, exit code, duration, and working directory.
- Each assistant entry links to its raw request. It shows what changed since the previous request: messages appended to the context, and changed system prompt, tools, or parameters. It also shows the payload as a collapsible tree with its size, the stream events, the assembled message, and the response headers. A network panel shows host, IP, TLS, headers, raw bodies, and a timing waterfall.
- Requests without an entry (compaction, summaries) and other network activity of the same process during the session are listed below the timeline.
- Compactions, branch summaries, model and thinking level changes, context edits, labels, and task notifications.
- Branches: entries that are not on the path to the last entry are marked as an abandoned branch, and entries with several children as branch points. Failed attempts that auto-retry removed from context are marked "omitted from context".
- Links to subagent transcripts, the parent session, and the session it was forked from.

Long texts are cut at 20,000 characters in the timeline and captured bodies at 2 MB; download links serve the full text.

**Insights** aggregates the filtered sessions:

- Totals: sessions with errors, tool error rate, model errors, retries, aborted sessions, tool calls without a result, average turns and tool calls, model latency p50 and p90, tokens, and cost.
- Tools by failures: calls, errors, error rate, and average and maximum duration per tool.
- Errors grouped by message. Paths, numbers, quoted strings, and ids are replaced with placeholders so the same failure groups together; each group links to example entries.
- Sessions where the agent struggled, ranked by tool errors, model errors, retries, aborts, unanswered tool calls, and long streaks of failing tool calls.
- Models, slowest tool calls, how model responses ended, and daily activity.

**Network** lists every captured HTTP request and WebSocket exchange across sessions. It shows time, session, provider and model, method, host, path, status, duration, time to first byte, bytes, and remote address. Filter by URL text, host, provider, status class, errors, minimum duration, and the date range. Click a row for headers, bodies, timings, and network details.

## Live updates

The server re-scans the session and trace directories every two seconds and notifies the page over server-sent events. New sessions and requests appear without restart, and an open session updates in place as the agent writes to it.

## Export and API

**Export JSON** in the filter bar downloads the filtered sessions as one JSON document with each session's summary and raw entries. In a session, **Export JSON** downloads that session the same way. All endpoints need the token:

| Endpoint | Returns |
| --- | --- |
| `GET /api/sessions` | Session summaries. Filter parameters: `q`, `project`, `model`, `errors=1`, `from` and `to` (`YYYY-MM-DD`), `subagents=include\|exclude\|only`, plus `limit` and `offset` |
| `GET /api/sessions/<key>` | Summary, timeline events, parent, and subagent sessions |
| `GET /api/sessions/<key>/raw` | The JSONL file |
| `GET /api/sessions/<key>/export` | Summary and raw entries as JSON |
| `GET /api/sessions/<key>/capture` | Captured model requests, tool executions, and other process activity of the session |
| `GET /api/capture/model/<id>` | One model request: payload, stream events, message, HTTP and WebSocket records, and the diff with the previous request |
| `GET /api/capture/http/<file>/<id>`, `/ws/<file>/<id>`, `/tool/<file>/<id>` | One HTTP request, WebSocket exchange, or tool execution with bodies |
| `GET /api/capture/blob/<file>/<name>` | A stored body in full |
| `GET /api/network` | Captured requests. Filter parameters: `q`, `host`, `provider`, `sessionId`, `status=2xx\|3xx\|4xx\|5xx\|error\|none`, `errors=1`, `slowMs`, `from`, `to` |
| `GET /api/network/facets` | Hosts and providers with request counts |
| `GET /api/aggregate` | Insights for the filtered sessions |
| `GET /api/export` | Summaries and raw entries of the filtered sessions |
| `GET /api/facets` | Projects and models with session counts |
| `GET /api/events` | Server-sent `version` events when sessions or traces change |

How durations are measured: a model call's latency is the time between the assistant message timestamp (taken when the request starts) and its session entry timestamp (written when the response ends). A tool call's duration is the time from the end of the assistant message that requested it to the tool result; captured tool executions measure the execution itself. Parallel tool calls in one message share the same start.
