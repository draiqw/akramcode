# Mermaid Markdown Transformer
Source: packages/coding-agent/src/modes/interactive/components/mermaid.ts

## Inline code encoding for diagram spacing
Each diagram row is encoded as an inline code span (backtick-delimited) to preserve spacing and box-drawing characters when rendered as markdown. Blank rows use non-breaking spaces to maintain visible height, since empty code spans would collapse.

## Backtick delimiter escaping in code spans
CommonMark inline code spans use matching backtick delimiters. To handle content with backticks, choose a fence longer than any existing backtick run in the content. If content starts or ends with a backtick, add padding spaces to keep that backtick as content (CommonMark removes the padding during rendering). This allows mermaid labels to preserve backticks without escaping.

## Hard breaks for line preservation
Each diagram row is rendered as a markdown hard break (`  \n`) to ensure every row stays on its own line. Without hard breaks, markdown would collapse whitespace and rows would merge.
