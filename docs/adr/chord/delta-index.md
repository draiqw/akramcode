# Chord Delta Operations

Source: packages/chord/src/delta/index.ts

## Overlap Algorithm Strategy

The overlap function uses a two-stage probe strategy: first trying a longer head to catch large overlaps efficiently (few candidates), then falling back to single-character matching to find any overlap. This avoids expensive KMP implementations which are asymptotically equivalent but slower in practice. Repetitive output patterns (build logs, character runs) can create thousands of candidate positions, so a candidate limit prevents unbounded work.

## Node's Experimental Strip Types Constraint

The `readonly` segment property cannot use parameter syntax because Node's `--experimental-strip-types` rejects those. These files must run directly under the flag, so the field is declared separately.

## String Path Safety Issue

A string is not a valid path—the validator checks if the input is an array. If an unchecked string like `"a".slice(0, -1)` becomes `""`, it resolves to ROOT and writes there, allowing `["s", ["__proto__", "isAdmin"], true]` to pollute `Object.prototype`. All ops come from untrusted sources (facets, plugins, tool output).

## Ownership Semantics for Operation Batches

Replacement operations adopt batches by reference rather than copying them. The consumer owns the batch it receives. Fanning one batch to multiple in-process consumers creates aliasing—an ownership rule, not a defect. Copying must happen at the fan-out point or each consumer must decode its own. Batches crossing boundaries are already distinct due to serialization.

## defineProperty for Write Protection

Using `defineProperty` instead of direct assignment prevents inherited setters from running on write, which could bypass immutability constraints.

## Own Properties Safety Constraint

Path traversal must only access own properties. An inherited getter could escape the value into the prototype chain, or external code could intercept reads, breaking encapsulation guarantees.

## Arity Omission Scope

Arity omission (shortening tuples by dropping the path when it matches the previous op) must be scoped per batch. Spanning batches would make a batch's first op depend on the previous batch's last one. A reader that skips or reorders batches would decode into the wrong path. Path ids are the only cross-batch state, explicitly tracked in the dictionary.

## Recovery Point After Replacement

A base batch (starting with replacement) is a recovery point: readers replay from the last base with a fresh decoder, so everything after must be self-contained. Keeping ids across a replacement emits references to definitions the decoder never saw, causing recovery to fail with unresolvable path ids.
