# Autocomplete

Source: packages/tui/src/autocomplete.ts

## Wrapper Stripping Strategy

Opening wrappers like "(", "[", "{" before a path require conditional handling: they are stripped to extract the pure path, but preserved if the wrapper has a matching closer within the same token. This allows detecting Next.js route groups or balanced expressions like `(group)/path` while normalizing wrapped input like `(~/path`.

## File Discovery with fd

The `fd` command walks the directory tree instead of Node.js fs APIs because it respects .gitignore rules and is significantly faster, making path autocompletion responsive even in large repos.
