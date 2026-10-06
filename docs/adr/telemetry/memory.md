# In-Memory Telemetry Context

Source: packages/telemetry/src/memory.ts

## Passive error inspection and recovery

Error inspection during error status creation is passive—if error inspection itself fails, we fall through to a generic error status without details. This prevents cascading failures where error handling introduces new errors.

## Passive telemetry recording with malformed data

Recording telemetry is passive and non-blocking. Malformed or unreadable telemetry payloads are silently ignored rather than thrown, ensuring that instrumentation failures do not propagate to application code.
