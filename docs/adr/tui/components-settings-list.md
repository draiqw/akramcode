# SettingsList Component

Source: packages/tui/src/components/settings-list.ts

## Hover does not change selection

Mouse hover events must not change the selected item because the visible range is centered on the current selection. Allowing hover to change selection would cause the viewport to jump unexpectedly, creating a poor user experience. Only explicit mouse clicks or keyboard navigation change the selection.

## Submenu input delegation and cancellation

When a submenu is active, all input is delegated to the submenu component without filtering. The submenu's `onCancel` handler (triggered by pressing Escape) calls the `done()` callback, which closes the submenu and restores control to the main list. This architecture ensures clean state management and prevents the main list from interfering with submenu interaction.
