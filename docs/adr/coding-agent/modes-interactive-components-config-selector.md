# Config Selector Component

Source: packages/coding-agent/src/modes/interactive/components/config-selector.ts

## Terminal Chrome Height Calculation

The resource list viewport height is calculated by subtracting 8 lines of UI chrome from the terminal height. These 8 lines consist of: top spacer, top border, spacer, header (which takes 2 lines), spacer, bottom spacer, and bottom border. A minimum of 5 lines is always reserved for the list display.
