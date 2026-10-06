# OpenAI Codex OAuth Flow

Source: packages/providers/src/auth/oauth/openai-codex.ts

## Lazy crypto import to avoid breaking browser/Vite builds

Top-level imports of Node.js crypto modules break browser and Vite builds. Instead, crypto is dynamically imported at runtime only when `process` indicates a Node.js or Bun environment, and the module validates the availability before use.

## Port 1455 fallback for callback server

Port 1455 is shared with the Codex CLI (external tool using the same port). When the port is already taken, we fall back to manual URL pasting to allow headless or remote sessions to complete the login flow without a local callback server.
