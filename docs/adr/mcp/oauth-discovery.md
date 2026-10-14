# OAuth Discovery

Source: packages/mcp/src/oauth/discovery.ts

## Empty scope values as absent

Servers send null or empty string for fields they have no value for. An empty scope carries no information and should count as absent, allowing the system to fall back to other scope sources.

## URL comparison without trailing slash

URL parsing adds a trailing slash to bare origins. When comparing the metadata issuer with the expected authorization server URL, both must be normalized by removing trailing slashes to ensure they match correctly.
