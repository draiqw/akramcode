# Model Runtime
Source: packages/coding-agent/src/core/model-runtime.ts

## Use builtin provider untouched without overlays
When there are no overlays configured, use the builtin provider untouched so its auth, login, and stream behavior is exact and unchanged.

## Cap output budget for virtual model routing
Requests outside the agent loop are routed through virtual models. Callers size the output before routing, so cap the output budget to what the routed model can handle.

## Keep caller credentials isolated in virtual model routing
Caller credentials were resolved for the virtual model's provider. Another provider resolves its own, so they are not sent to the wrong vendor.

## Compatibility fallback for older ModelsStore
Published akramcode-ai builds before ModelsStore returned void and accepted a provider ID. The fallback keeps source-mode CLI tests working without rebuilding workspace dependencies.

## Availability errors and model refresh isolation
Availability errors are recorded by the latest pass; refreshed models remain usable even if availability checks fail.

## Validate registration independently
Validate the incoming registration on its own before applying: a broken re-registration must throw without touching the stored config. Re-registration merges defined values over the previous registration and preserves undefined ones, matching the legacy ModelRegistry contract.

## Virtual providers need no credentials
A provider defined only by virtual models needs no credentials. Mark it configured now: session restore checks auth before the refresh below lands, so this provisional status lets session restoration work.

## Failed routing with virtual models
A failed routing attempt names the virtual model; there is no physical request to report. The failed model returned is the target that failed, not the virtual model.
