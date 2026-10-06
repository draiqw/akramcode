# Markdown Component

Source: packages/tui/src/components/markdown.ts

## Streamed code block fence trimming

Partial closing fences from streamed markdown are trimmed to prevent code blocks from shrinking or flickering when the final fence character arrives. Without this, incomplete fences would be rendered, then replaced when the full fence arrives, causing visual instability. See https://github.com/earendil-works/pi/issues/5825.

## Weak reference caching for parsed tokens

Parsed markdown tokens depend only on the source text, so they survive theme and width invalidation and are reused across re-renders. However, tokens are held with WeakRef because a token tree is approximately ten times the size of the source text. Weak references allow token caches to survive brief re-render bursts (like theme previews) while being garbage collected afterwards to save memory in long transcript sessions.

## Layered background and padding application

Background color is intentionally NOT applied during default text styling or inline token rendering. Instead, it is applied only at the padding stage to ensure the background extends to the full line width, creating a cohesive visual block rather than disconnected colored segments.

## Blockquote rendering with separate token stream

Blockquotes contain block-level tokens (paragraphs, lists, code blocks), so they are rendered with `renderToken()` instead of `renderInlineTokens()`. Default message styling is explicitly excluded inside blockquotes so that quote formatting takes precedence.

## Empty quote line removal

Extra empty quote lines before outer blockquote spacing are trimmed to prevent visual padding buildup that would make quotes appear overly spaced.

## Link fallback URL display logic

When hyperlink capability is unavailable, the link URL is compared against the link text. If they match (or the text matches the URL with the "mailto:" prefix removed for auto-linked emails), only the styled link text is shown. Otherwise, the URL is appended in parentheses to disambiguate auto-generated links.
