# Tool Execution and Results

Source: packages/durable/src/harness/tool.ts

## Recovery Rerun Strategy

After an interrupted execution, the recovery phase reruns only when both the stored and current replay policies say `safe`. A safe rerun clears any partial output the interrupted attempt published before rerunning from scratch.

## Failed Status Cascading

When a tool execution throws or is interrupted and recovery cannot rerun it safely, the task ends `failed`. This status records cancellation intent, so the conversations this tool call owns, left unsupervised, are automatically aborted.

## Commit Outcome Consistency

When marking details in progress commits, the outcome stays observed even if the wait is cancelled. Cancelling the mark's context leaves the committed state consistent.

## Environment at Call Time

The tool's environment is fetched at each call during execution, not at task creation. This ensures a rerun after recovery gets the conversation's environment as it exists at that time.

## Tool Error Entry Ownership

When an execution throws, the error text is already captured in the result entry before the task ends. The entry creation happens atomically with the terminal state, ensuring the transcript contains the error regardless of subsequent failures.

## Progress Commit Final Flush

Details waiting for a progress commit settle together with the terminal commit when execution ends. This is the final flush that ensures all buffered progress reaches the entry.

## Synchronous Progress Capture

Before each progress commit, capture everything synchronously including output and details snapshots. The tool keeps reporting while the commit is in flight, so we must capture the current state atomically.

## Chord Diff Optimization

Chord diffs the string of output as an append when it's a prefix, or a trim plus append for sliding tail retention. If the whole slot object were replaced instead, Chord would record the entire window on every commit.

## Output Field Delta Encoding

Assign `output` as one string field rather than appending chunks. Chord then diffs it incrementally and applies it as append or sliding trim, avoiding large delta writes.

## Details and Diagnostics Diffing

Diff details leaf by leaf and append new diagnostics separately. This ensures each progress commit writes only what changed, not the full state.

## Error Handling in Progress Commits

Rejections during progress commits after an abort mark or close are expected and do not indicate data loss. The committed state stays consistent even when progress commits fail.

## Truncation Application Timing

The retained output's truncation diagnostic applies only while the `afterTool` hook keeps the content from the retained buffer. If `afterTool` replaces it with different content, truncation from retention no longer applies.

## Control Object Normalization

Tools build control objects freely. Undefined keys are dropped so the task result becomes strict JSON without spurious `undefined` values.
