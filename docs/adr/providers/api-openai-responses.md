# OpenAI Responses API Integration

Source: packages/providers/src/api/openai-responses.ts

## ChatGPT Sign-In Compatibility Mode

Sign in with ChatGPT (non-API key authentication) rejects several standard OpenAI Responses API request fields including `prompt_cache_retention`, `prompt_cache_options`, and temperature overrides. These fields must be omitted for ChatGPT sign-in to succeed, degrading to simpler request structure while maintaining core functionality.

## ChatGPT Subscription Sharing Limitation

Sign in with ChatGPT shares the subscription's usage limit with other OpenAI apps and services. Subscription-related errors are supplemented with a link to ChatGPT usage settings so users can diagnose quota issues.
