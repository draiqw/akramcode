# Extension runner - lifecycle and event handling

Source: packages/coding-agent/src/core/extensions/runner.ts

## Extension shortcuts keybinding priority

Extension shortcuts compete with canonical keybinding IDs from keybindings.json. Only editor-global shortcuts are reserved here; picker-specific bindings are not. When multiple actions bind the same key, reserved actions win so extensions remain blocked by reserved shortcuts regardless of iteration order.

## System message preservation for context handlers

When a context handler modifies the conversation messages, the system prompt and tool state must be re-attached afterward. Context handlers only see the conversation; system messages belong to AkramCode. Handlers that preserve the conversation also preserve every system message, allowing models with mid-conversation support to keep cached prefixes. When the conversation changes, the prompt sections and tool declarations are replayed as a single leading system message to prevent pruning or windowing from dropping them.

## Immediate provider registration after bind

After bindCore() completes, provider registration and unregistration take effect immediately without requiring a /reload. This differs from the pre-bind phase where registrations queue until bindCore() flushes them.

## Server registration timing and connection

MCP servers registered before mcp_servers_change handlers are connected are queued for delivery on session_start. Servers registered after binding reach the connecting extension immediately when registered.

## Leading system message preservation in handlers

When context_with_system handlers modify the message array, the leading system message must not be removed. Providers read the prompt and initial tools from this message. If it is lost, the request has no prompt or initial tool declarations, which is never intended. Handlers should keep the system message at index 0, or replace a dropped prefix with getCurrentSystemMessage().
