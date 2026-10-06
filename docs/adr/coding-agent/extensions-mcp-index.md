# MCP Extension Integration
Source: packages/coding-agent/src/extensions/mcp/index.ts

## Tool name hash suffix handling
Tool name collisions are resolved consistently by assigning hash suffixes to all sanitized duplicates. This ensures that which tool name remains plain does not depend on tool discovery order, matching Codex's behavior.

## Dropped tools reregistration
The tool registration system does not support unregistering tools. When a server stops offering a tool, we re-register it with `hidden` exposure to make it unreachable. When the server offers it again later, it is registered with its configured exposure level.

## Challenge clearing after signin
After successful sign-in, the OAuth challenge that prompted the sign-in (e.g., for additional scope) has been answered and should be cleared to avoid re-triggering sign-in flows.

## Direct tool deactivation
When tool exposure changes, tools no longer exposed directly are removed from the active tools set to reflect the new visibility. Direct tools remain active since they are activated automatically on registration.

## Discovery tool activation
Codemode and tool_search are activated from configuration so that the first prompt does not wait for servers with non-declared tools, but scripts and searches can find those tools when needed.

## Lazy MCP client loading
The MCP client library only loads once a server is configured, so sessions without MCP servers never pay the performance cost. We wait one event loop turn before loading to let the first UI render complete before the client initializes and starts connecting.

## Bounded direct server wait
The first prompt waits only for servers with directly-declared tools, and only for a limited time. Slow or hanging servers must not block prompt generation; other servers are waited for on-demand when scripts or searches need them.

## Dynamic servers section update
The `mcp_servers` section in the system prompt reflects servers as they are when each prompt starts. The section is appended to the conversation when it changes (e.g., when a server connects) so the model sees current server availability.

## Selective server wait on tool call
Codemode scripts wait for servers they explicitly reference by name or search for via enumeration, ensuring their tools are registered before script execution. Tool_search and resource tools reach all servers, so they wait for all connections.
