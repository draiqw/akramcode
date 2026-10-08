# RPC Mode Operation

Source: packages/coding-agent/src/modes/rpc/rpc-mode.ts

## Extension UI limitations in RPC mode

The RPC protocol provides only request-response communication over JSON stdin/stdout. Many interactive UI features from the TUI mode require direct access to the terminal or component rendering system, which RPC mode cannot support. Features like working indicators, custom footer/header, and theme switching are headless-incompatible.

## Fire-and-forget notifications

Certain UI methods (notify, setStatus, setTitle, setEditorText) are fire-and-forget: the client sends the request but does not wait for a response. This simplifies the protocol and works because these operations don't require confirmation.

## Synchronous editor methods

Methods like getEditorText() cannot wait for RPC responses since they must return synchronously. The host application should track editor state locally if needed, or use the async editor() method for full editor interaction.

## Paste operation fallback

Paste handling in RPC mode falls back to setEditorText since pasting requires terminal integration that headless mode doesn't have.

## String-only widgets

Widget content in RPC mode accepts only string arrays, not factory functions. Component factories require TUI rendering access which RPC mode cannot provide.

## Prompt handling behavior

Prompt commands emit success responses immediately after preflight validation, not after the entire agent run completes. This allows the client to know immediately whether the prompt was accepted or queued, while still receiving stream events as the agent processes.

Preflight is asynchronous (input handlers, auth check, `before_agent_start`), so prompt commands wait for the previous prompt's preflight before starting their own. Without this, two prompts written in one stdin chunk both pass the "not streaming" check, both report `started`, and the second run fails silently because the agent is already busy. With it, the second prompt sees the first run and is rejected or queued according to `streamingBehavior`.
