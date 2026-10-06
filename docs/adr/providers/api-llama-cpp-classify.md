# Llama.cpp Classification API

Source: packages/providers/src/api/llama-cpp-classify.ts

## Reasoning Block Template Handling

Some chat templates automatically open a reasoning block for the reply. When templates are run with thinking disabled, this leaves an empty block. Closing it immediately leaves the state consistent with the template output, allowing the next token to be the answer label.
