# Context Derivation

Source: packages/durable/src/harness/context.ts

## Edit tracking across all entries

When collecting edits in a context range, we process every entry in the range including older head markers that `selectActive()` later drops from the active entries. This ensures that edits targeting other entries are always found, regardless of which head marker becomes the active one.
