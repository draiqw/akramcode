# Path Utils

Source: packages/coding-agent/src/core/tools/path-utils.ts

## macOS filename normalization variants

macOS stores filenames in NFD (decomposed) Unicode form, but users typically type NFC (composed) form. Additionally, macOS uses U+2019 (right single quotation mark) in screenshot filenames, while users type U+0027 (straight apostrophe). The path resolver tries multiple normalized variants to match user input against actual filesystem entries: NFD normalization, curly quote substitution, and combinations thereof. This is particularly important for French macOS screenshots like "Capture d'écran" which may use both transformations simultaneously.
