# Session-to-Chord Bridge for Observed Documents

Source: packages/durable/src/session/observation.ts

## Listener error isolation

The Chord frame listener mechanism is designed to handle certain contract failures. When the direct listener throws an unexpected error (not a contract violation from Chord), we dispose the attachment immediately to isolate that failure and prevent further event delivery to a broken listener.
