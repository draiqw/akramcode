# ANSI regex performance

Source: packages/coding-agent/src/utils/ansi.ts

## Automatic lastIndex reset in replace

We don't manually reset the `.lastIndex` property when using regex replacement. The `.replace()` method automatically handles this, while manual reset carries a performance penalty.
