# Remote Catalog Provider

Source: packages/coding-agent/src/core/remote-catalog-provider.ts

## Conditional ETag Validation

The ETag validator is only sent to the server when a cached catalog body exists. This prevents HTTP 304 responses from leaving the overlay empty if the validator exists but the catalog models are missing. When there is no cached body, skipping the validator request avoids misleading revalidation attempts.

## 304 Response Handling

When receiving a 304 Not Modified response, only the freshness timestamp (checkedAt) is updated. The dynamic models overlay already holds the stored catalog, so no model data changes are needed, only the cache metadata.

## Transient Failure Recovery

When a transient HTTP failure occurs (non-2xx, non-404 status), both the cached body and its validator remain valid. The etag is preserved to allow the next refresh to revalidate the cached catalog instead of downloading it again. If the refresh fails permanently, the cached version continues to be used until network connectivity returns.
