# MCP Runtime
Source: packages/coding-agent/src/extensions/mcp/runtime.ts

## Session expiry retry strategy
When a session expires on the server (from restart or deployment), the request did not execute there. Retrying on a new session gives the operation one more chance. The old client is detached but not closed to avoid interrupting other in-flight calls that will get the same 404 and retry independently.

## Tools capability handling
Servers that only provide prompts or resources (without tools capability) do not respond to tools/list requests, so we check the capability flag before calling the method.

## Token rotation safety
After a response is received from the server, it may have rotated the refresh token. Waiting for any in-flight refresh to complete ensures the new tokens are saved before shutdown, preventing loss of the refreshed grant.
