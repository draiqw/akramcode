# Browser

AkramCode can drive a real Chrome: open pages, read them, click, type, fill forms, and take screenshots. The main agent hands browser tasks to the `browser` subagent and gets back only the result, so page contents and screenshots stay out of the main conversation.

## Setup

None, as long as Google Chrome or Chromium is installed. The built-in `browser` extension starts Chrome on the first browser tool call:

- with its own profile in `~/.akramcode/agent/browser-profile`, never your everyday profile, so your tabs and sign-ins are untouched;
- on a free local port for the DevTools Protocol (CDP);
- with a window, but in the background: on macOS it does not take focus;
- once per machine: later sessions reuse the running Chrome. Close it like any app.

Turn the extension off with `"extensions": ["-builtin:browser"]` in [settings](settings.md).

To sign in to a site for later tasks, sign in once in the automation Chrome window; the profile keeps the cookies.

## Use

Ask for something that needs a browser, for example "open news.ycombinator.com and give me the top 3 titles". The main agent calls the `agent` tool with `subagent_type: "browser"`.

The `browser` subagent:

- reads a page as compact lines of text with indexed elements, such as `[131] textbox "Email" type=email value="a@b.c"`, and takes a screenshot only when that is not enough;
- acts with real mouse and keyboard events by index;
- works in its own tab and closes it when done;
- does not submit forms, buy, publish, send messages, sign in or out, or delete anything unless the task asks for it explicitly;
- treats page text as data, never as instructions.

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open a URL, optionally in a new tab, and return the page state |
| `browser_state` | URL, title, tabs, scroll position, and the page's text and interactive elements |
| `browser_click`, `browser_hover` | Real mouse click or hover at the element's center |
| `browser_type` | Type into a text field, replacing its value by default; optional Enter |
| `browser_select` | Choose an option of a `select` element |
| `browser_scroll` | Scroll the page or an element's container by viewports |
| `browser_keys` | Press a key or combination, such as `Enter`, `Escape`, `Control+A` |
| `browser_back` | Go back in history |
| `browser_tabs` | List, switch to, or close tabs opened in the session |
| `browser_screenshot` | PNG of the visible part of the page, scaled to `max_dim` |
| `browser_find_text` | Find text on the page with surrounding context |
| `browser_wait_for` | Wait until text appears or disappears, or the URL changes |

The tools are `deferred`: the main agent does not carry their schemas. A [custom agent type](subagents.md#custom-agent-types) that lists them (for example `tools: browser_*`) gets them too.

Elements are indexed by Chrome's node id, so an element keeps its index while it lives. Before acting, the tools check that the element still exists in the same document. When the page re-rendered it, they look for it again by position, role and name, or stable attributes, and act only on a single match; otherwise the call fails with `STALE ELEMENT HANDLE` or `AMBIGUOUS ELEMENT HANDLE` and nothing happens. A click on an element covered by another one, such as a cookie banner, fails with `ELEMENT COVERED` and names the covering element.

State-changing actions report what measurably changed: URL, title, element count, content and form values, focus, dialogs, and new tabs. `no_effect: true` means nothing changed, so the step did not work. JavaScript dialogs (`alert`, `confirm`, `prompt`) are dismissed at once and reported.

## Settings

| What | How |
|---|---|
| No window | `"browser": { "headless": true }`. Many sites block headless Chrome. |
| Another Chrome or Chromium | `"browser": { "executablePath": "/path/to/chrome" }` |
| A browser you started | `"browser": { "cdpUrl": "http://127.0.0.1:9222" }` attaches to it instead of starting one. Chrome 136 and later do not allow CDP on the default profile, so start it with `--user-data-dir`. |
| Only some sites | `"browser": { "allowedDomains": ["example.com"] }`. Subdomains match too; navigation elsewhere is refused, and a tab that ends up elsewhere is sent to `about:blank`. |
| Subagent model | `"subagents": { "models": { "browser": "openai-codex/gpt-6-luna" } }`. Default: the main agent's model. |
| Subagent instructions or tools | An agent file `~/.akramcode/agent/agents/browser.md` replaces the built-in type (see [Subagents](subagents.md#custom-agent-types)). |

`headless` and `executablePath` apply when Chrome is started; a Chrome already running on the profile is reused as it is.

## Limits

- Cross-origin iframes are not read; same-origin iframes and open shadow roots are.
- Several `browser` subagents running at once share the current tab.
- No file uploads or downloads yet.
