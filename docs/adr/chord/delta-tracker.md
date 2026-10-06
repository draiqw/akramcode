# Chord Delta Tracker

Source: packages/chord/src/delta/tracker.ts

## Materialization Ownership

Materialization happens during prepare. Adoption is an infallible pointer swap so storage failure can discard the candidate without touching authority. The operation payloads are already detached from the mutable overlay, and the resulting revision and public batch intentionally share those payloads under the trusted immutable-transfer contract.

## Adoption Context Cleanup

When adoption invalidates competing contexts, it must not walk every node touched by a draft. Instead, drop the context's strong overlay references in O(1); externally retained proxies still see the stale status and are reclaimed with their holders.

## Native Splice Performance

Native `splice` and permutation operations remain faster for large structural batches than manual element-by-element manipulation.

## Stable Insertion Sort Strategy

Stable insertion sort avoids allocating comparators and buckets for the usual handful of dirty object nodes, making it faster for small sorts.

## Immutable Replay Delete-Readd Encoding

Immutable replay must encode delete-and-readd explicitly so string-key insertion order matches the draft. Without this, replayed results would have different key ordering than the original.

## V8 Rope Optimization

Slice/equality operations on ropes stay on V8's rope fast path for string operations. The `startsWith` method, by contrast, scans the entire accumulated prefix on every call, making it unsuitable for accumulated string building.
