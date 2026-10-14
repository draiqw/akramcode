# OAuth Types

Source: packages/mcp/src/oauth/types.ts

## URL validation without try-catch

URL parsing can throw a TypeError for invalid URLs. The discovery layer reserves TypeError to indicate network failures distinct from invalid metadata. Therefore, we check URL validity with URL.canParse() instead of using try-catch, preserving TypeError for actual network errors.
