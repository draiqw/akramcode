# Codemode Runtime Worker

Source: packages/codemode/src/runtime/worker.ts

## QuickJS Stack Guard

Deep recursion can overflow the wasm stack and trap instead of throwing a catchable RangeError. We set maxStackSize to guard against this.

## Bridge Function Primitives

The bridge function is called from the prelude with primitives only (no complex objects), keeping the VM boundary simple and predictable.

## VM Lifetime Management

The VM lives until the host terminates the worker, so the handles returned from scope operations are never disposed—they remain valid for the worker's lifetime.

## Script Line Number Preservation

The evaluation prefix shares its first line with the user script so that reported line numbers match the script as the user wrote it, not accounting for wrapper indentation.
