# Session Selector Component
Source: packages/coding-agent/src/modes/interactive/components/session-selector.ts

## Load Progress Scoping
Progress state is tied to the current load operation; it must be cleared whenever the loading state changes to prevent stale progress indicators from persisting across load cycles.

## Hint Line State Management
Hint lines update based on UI state: delete confirmation displays confirmation prompt; status messages show errors or info; default state shows available actions. All branches are truncated to terminal width.

## Focusable IME Support Pattern
The focused property delegates to child components (session list and rename input) to enable proper IME (Input Method Editor) cursor positioning in terminal environments.

## Threaded vs Flat Session Display
Threaded mode without search query renders sessions as a hierarchical tree by parent-child relationships; other modes or when searching show a flat list for faster navigation.

## Delete Prevention for Active Session
The currently active session cannot be deleted to prevent orphaning or breaking the current context.

## Ctrl+D Terminal Compatibility
Use Ctrl+D for delete initiation because some terminals do not distinguish Ctrl+Backspace from regular Backspace, making Ctrl+D more reliable.

## Non-Invasive Backspace Delete
Ctrl+Backspace is a convenience alias for delete that only triggers deletion when the search query is empty; otherwise it deletes backward from the search input instead.
