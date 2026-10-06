# Chord Type Definitions

Source: packages/chord/src/types.ts

## JSON Type Recursion Termination

A type assignable to readonly JSON is valid as-is. We do not walk recursive JSON types (like those with readonly arrays) because doing so would never terminate—TypeScript would infinitely recurse.
