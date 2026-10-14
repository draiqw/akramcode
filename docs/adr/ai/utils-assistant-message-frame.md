# Assistant Message Frame Encoding

Source: packages/ai/src/utils/assistant-message-frame.ts

## Legacy Grammar Tool Calls Handling

Legacy grammar calls include the initial input in toolcall_start, but their JSON delta stream still begins at an empty input. To handle this, the encoder checks if the parsed arguments extend (rather than exactly reproduce) the start snapshot, allowing graceful handling of this SDK-specific behavior difference.
