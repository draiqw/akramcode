# AkramCode CLI Reference

Live sources when anything looks stale: `akramcode --help`, `akramcode <command> --help`,
https://akramcode-agent.nousresearch.com/docs/reference/cli-commands

### Global Flags

```
akramcode [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
akramcode chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
akramcode setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
akramcode model                Interactive model/provider picker
akramcode fallback [add|remove|list]  Fallback provider chain
akramcode config [show|edit|get|set|unset|path|env-path|check|migrate]
akramcode login / logout       OAuth sign-in / clear stored auth
akramcode doctor [--fix]       Check dependencies and config
akramcode status [--all]       Component status
```

### Tools & Skills

```
akramcode tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

akramcode skills list|browse|search QUERY|inspect ID
akramcode skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
akramcode skills config        Enable/disable skills per platform
akramcode skills check|update|uninstall|publish PATH
akramcode skills tap add REPO  Add a GitHub repo as a skill source
akramcode bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
akramcode mcp add NAME (--url or --command) | remove | list | test NAME
akramcode mcp catalog | install NAME     Curated catalog install
akramcode mcp configure NAME             Toggle tool selection
akramcode mcp serve                      Run AkramCode as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
akramcode gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `akramcode photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://akramcode-agent.nousresearch.com/docs/user-guide/messaging/

### Sessions

```
akramcode sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
akramcode cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
akramcode webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
akramcode profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
akramcode profile rename A B | alias NAME | export NAME | import FILE
akramcode profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
akramcode auth                 Interactive credential manager
akramcode auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
akramcode auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
akramcode desktop / gui        Native desktop app
akramcode dashboard            Web admin panel + embedded chat (--stop / --status)
akramcode proxy                OpenAI-compatible local proxy backed by an OAuth provider
akramcode portal               Quick setup / sign in via Nous Portal
akramcode kanban <verb>        Multi-agent work-queue board
akramcode project              Named multi-folder workspaces
akramcode skin list|use|set    Switch/tweak skins (see references/themes.md)
akramcode pets <verb>          Pet mascots (see references/petdex.md)
akramcode memory setup|status|off|reset   Memory provider
akramcode secrets bitwarden|onepassword   External secret stores
akramcode moa                  Mixture-of-Agents slots
akramcode hooks / security / backup / import / checkpoints / console
akramcode logs [-f] [errors]   View agent/error logs
akramcode send                 One-off message through a gateway platform
akramcode pairing / plugins / insights / journey / computer-use
akramcode acp                  ACP server (IDE integration)
akramcode completion bash|zsh|fish
akramcode update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `akramcode photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `akramcode config edit` · [Configuration docs](https://akramcode-agent.nousresearch.com/docs/user-guide/configuration) |
| Tools / toolsets | `akramcode tools list` · [Tools reference](https://akramcode-agent.nousresearch.com/docs/reference/tools-reference) |
| Skills catalog | `akramcode skills browse` · [Skills catalog](https://akramcode-agent.nousresearch.com/docs/reference/skills-catalog) |
| Provider setup | `akramcode model` · [Providers guide](https://akramcode-agent.nousresearch.com/docs/integrations/providers) |
| Env variables | `akramcode config env-path` · [Env vars reference](https://akramcode-agent.nousresearch.com/docs/reference/environment-variables) |
| Gateway logs | `~/.akramcode/logs/gateway.log` (or `akramcode logs`) |
| Sessions | `akramcode sessions browse` (reads state.db) |
