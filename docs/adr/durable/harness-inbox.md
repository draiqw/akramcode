# Inbox: Submission Queueing

Source: packages/durable/src/harness/inbox.ts

## Entry Copies Before Removal

`appendEntry()` copies drafts synchronously, so inbox items are removed only after the appended entry is persisted. This ensures items aren't lost between the copy and persistent state.
