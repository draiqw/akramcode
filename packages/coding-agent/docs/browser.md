# Browser

AkramCode can drive a real Chrome: open pages, read them, click, type, fill forms, and take screenshots. The main agent hands browser tasks to the `browser` subagent and gets back only the result, so page contents and screenshots stay out of the main conversation.

## Setup

None, as long as Google Chrome or Chromium is installed. The built-in `browser` extension starts Chrome on the first browser tool call:

- with its own profile in `~/.akramcode/agent/browser-profile`, never your everyday profile, so your tabs and sign-ins are untouched (other profiles live in `~/.akramcode/agent/browser-profiles/<name>`);
- on a free local port for the DevTools Protocol (CDP);
- headless, without a window, so it never takes focus;
- once per machine: later sessions reuse the running Chrome. Stop it with `pkill -f akramcode/agent/browser-profile`.

Turn the extension off with `"extensions": ["-builtin:browser"]` in [settings](settings.md).

## /browser

`/browser` changes how the agent's browser works and saves the choice in the global settings:

- **window**: off by default, so Chrome runs without a window and never takes focus. On, the agent's Chrome opens a visible window where you can watch and step in by hand; it can take focus, and it is the way to use sites that block headless Chrome. Switching restarts the agent's Chrome.
- **profile**: the agent's Chrome profile. Each profile keeps its own cookies and sign-ins; **+ new profile** creates one. **my Chrome** drives your everyday Chrome instead, with your tabs and sign-ins (see below).
- **sign in to sites**: opens the current profile in a normal Chrome window. Sign in to the sites the agent needs, then choose **Done**: the window closes, and the agent uses those sign-ins without a window from then on.
- **mark agent tabs**: on by default. Tabs the agent drives get an orange `a` icon in the tab strip, an orange border, and an `akramcode` badge, so they stand out next to your own tabs in **my Chrome** and in the window. The marker ignores the mouse and is not part of what the agent reads.

### Your everyday Chrome

Chrome 136 and later refuse remote control of your everyday profile when Chrome is started with a debugging flag. Chrome 144 and later allow it another way: in `/browser`, choose **profile**, then **my Chrome**. If remote debugging is off, AkramCode opens `chrome://inspect/#remote-debugging` in your Chrome; check **Allow remote debugging for this browser instance** and choose **Done**. Chrome may ask you to allow the connection, and shows that it is controlled by automated software while connected.

The agent opens its own tabs there and leaves yours alone: it neither reads nor closes them, and only its own tabs are checked against `allowedDomains`. Your download settings stay as they are.

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

Elements are indexed by Chrome's node id, so an element keeps its index while it lives. Before acting, the tools check that the element still exists in the same document. When the page re-rendered it, they look for it again on the same page (same frame, and the same URL unless the document stayed the same, as after `pushState`) by position, role and name, or stable attributes, and act only on a single match; a named element's position counts only when no other element has the same role and name, so a removed list row never shifts the action to the next row. Otherwise the call fails with `STALE ELEMENT HANDLE` or `AMBIGUOUS ELEMENT HANDLE` and nothing happens. A click on an element covered by another one, such as a cookie banner, fails with `ELEMENT COVERED` and names the covering element.

State-changing actions report what measurably changed: URL, title, element count, content and form values, focus, dialogs, and new tabs. `no_effect: true` means nothing changed, so the step did not work. JavaScript dialogs (`alert`, `confirm`, `prompt`) are dismissed at once and reported.

## Settings

| What | How |
|---|---|
| A visible window | `"browser": { "view": "window" }`; the default is `"hidden"`. See [/browser](#browser). |
| Profile | `"browser": { "profile": "work" }`; `"useMyChrome": true` drives your everyday Chrome. |
| Tab marker | `"browser": { "highlight": false }` turns it off. |
| Another Chrome or Chromium | `"browser": { "executablePath": "/path/to/chrome" }` |
| A browser you started | `"browser": { "cdpUrl": "http://127.0.0.1:9222" }` attaches to it instead of starting one. Chrome 136 and later do not allow CDP on the default profile, so start it with `--user-data-dir`. |
| Only some sites | `"browser": { "allowedDomains": ["example.com"] }`. Subdomains match too. Every document request of the session's tabs is checked before it is sent, including redirects, links, form posts, new tabs, popups, and frames (new tabs and frames start paused until the check is in place), so a page cannot send the browser elsewhere. Scripts, images, and other resources a page loads are not restricted. Tabs the session did not open, such as your own in a `cdpUrl` browser, are not checked. |
| Subagent model | `"subagents": { "models": { "browser": "openai-codex/gpt-6-luna" } }`. Default: the main agent's model. |
| Subagent instructions or tools | An agent file `~/.akramcode/agent/agents/browser.md` replaces the built-in type (see [Subagents](subagents.md#custom-agent-types)). |

With or without `allowedDomains`, only `http`, `https`, and `about:blank` pages open: `file:`, `chrome:`, and `view-source:` URLs are blocked, so neither a page nor the model can read local files or browser internals. Downloads are denied in the Chrome AkramCode starts; a `cdpUrl` browser keeps its own download settings.

These settings are read from `~/.akramcode/agent/settings.json` only; project settings cannot set them. `executablePath` applies when Chrome is started; a Chrome already running on the profile is reused unless it runs in another `view`.

## Limits

- `browser_state` reads open shadow roots and iframes that run in the page's process (same site); iframes of other sites are not read. `browser_find_text` and `browser_wait_for` see only same-origin iframes.
- Several `browser` subagents running at once share the current tab.
- No file uploads or downloads.
