# Open Browser Utility

Source: packages/coding-agent/src/utils/open-browser.ts

## Best-Effort Launcher Error Handling

Browser launch is designed to be best-effort. Spawn reports launcher failures (e.g., missing xdg-open) via an error event, but since callers still present the target URL to the user, launcher errors are silently caught to prevent process crashes.

## No Shell Invocation for Security

The function intentionally never invokes a shell to avoid URL injection attacks. On Windows, using `cmd /c start` would allow cmd.exe to re-parse metacharacters before executing start, making attacker-controlled URLs injectable.
