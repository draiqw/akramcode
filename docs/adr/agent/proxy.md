# Proxy

Source: packages/agent/src/proxy.ts

## Flush Remaining Buffer After Stream Ends

When reading a streaming response, the final event may not be newline-terminated. After the stream ends, we must flush the text decoder and process any remaining data in the buffer to ensure no partial event is lost.

## Clean EOF As Server Error

A clean end-of-file (EOF) without a terminal `done` or `error` event indicates the server unexpectedly dropped the response mid-stream. We treat this as an error rather than silently leaving consumers waiting on a result that never arrives, ensuring the caller is notified of the failure.
