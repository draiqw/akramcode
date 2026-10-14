# SelectList Component

Source: packages/tui/src/components/select-list.ts

## Hover does not change selection

Mouse hover events must not change the selected item because the visible range is centered on the current selection. Allowing hover to change selection would cause the viewport to jump unexpectedly, creating a poor user experience. Only explicit mouse clicks or keyboard navigation change the selection.
