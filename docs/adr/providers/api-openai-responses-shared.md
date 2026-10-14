# OpenAI Responses API Shared Utilities

Source: packages/providers/src/api/openai-responses-shared.ts

## Item ID Handling for Cross-Model Replay

For different-model messages, item IDs are omitted to avoid OpenAI's pairing validation that tracks which item IDs were paired with reasoning items. By dropping IDs, the validation is bypassed similar to cross-provider scenarios. Additionally, IDs must match the replayed item type: function_call IDs start with `fc_`, custom_tool_call IDs start with `ctc_`. Foreign tool call IDs are normalized to `fc_`, and calls can switch types when grammar tool support differs between models.

## Reasoning Signature Backfill from Terminal Response

Azure OpenAI can omit `reasoning.encrypted_content` from individual `response.output_item.done` events and provide it only in the terminal `response.completed.response.output`. The persisted reasoning signature is backfilled from the terminal response to keep store:false multi-turn replay stateless, preventing loss of encrypted content metadata across conversation turns.
