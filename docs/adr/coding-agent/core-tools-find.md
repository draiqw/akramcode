# Find Tool

Source: packages/coding-agent/src/core/tools/find.ts

## Placeholder glob operation

The default glob operation is a placeholder. Actual fd command execution happens in the execute function when no custom glob provider is given.

## Git-aware .gitignore handling

fd normally ignores .gitignore outside git repos, so we keep the --no-require-git flag in that case. Inside repos, we use fd's default git-aware behavior so parent .gitignore rules stop at nested repo boundaries, preventing nested repos from inheriting parent ignore rules.

## fd pattern matching with full paths

fd --glob matches against the basename by default unless --full-path is set. In full-path mode it matches against the absolute candidate path, so a path-containing pattern like 'src/**/*.spec.ts' needs a leading '**/' to match anything. On Windows, fd matches using native separators, so we convert forward slashes to the platform-specific pattern.
