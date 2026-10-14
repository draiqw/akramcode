# Grep Tool

Source: packages/coding-agent/src/core/tools/grep.ts

## Deferred match formatting for async operations

Format matches after streaming finishes rather than during the stream. This allows custom readFile() backends to be async, which would block the streaming event loop if done during the stream.

## No line limit in output truncation

Apply byte truncation without a separate line limit because the match limit already capped the number of result rows. Adding a line limit would be redundant and confusing.

## tgrep backend

`grep.backend: "tgrep"` sends directory searches to a running `tgrep serve` and falls back to ripgrep on any doubt. The output stays the same for the model because tgrep prints ripgrep's `--json` events and both go through the same formatting.

tgrep resolves a search in three ways: the server, the on-disk index in `.tgrep/`, or a full scan. Only the server is useful here. The on-disk index is as old as its last save, and the scan is slower than ripgrep. So the tool runs tgrep only when `.tgrep/serve.json` names a live process, passes `--index-path` so that a search below the indexed root reaches that server, and accepts the result only when `--stats` reports `(via server)`.

`serve.json` is not trusted by its presence. A repository can ship one, and another local user can plant one in a shared or writable directory, pointing at a process that returns made-up results marked `(via server)`. tgrep itself always connects to `127.0.0.1:<port>`, but any local process can listen there. So before tgrep runs, the tool requires that the indexed directory, `.tgrep` and `serve.json` are not symlinks and not group- or other-writable, that `.tgrep` and `serve.json` belong to the current user, and that git does not track `serve.json`. `lsof` then has to show that the named pid runs as the current user, runs the configured tgrep executable (by real path), holds `.tgrep/serve.lock` open (the lock tgrep takes for the server of that index), and listens on the named port on 127.0.0.1 or ::1. Any failed or unavailable check means ripgrep. The tgrep binary that passed the check is the one spawned for the search. The `lsof` call takes about 100ms, so a verification is cached for 60 seconds keyed by the binary, index directory, pid, port and the inode and mtime of `serve.json`; the pid is checked for liveness on every search.

That check needs the process to finish, so tgrep is not killed at the match limit like ripgrep. `--max-count <limit>` bounds the output per file without changing the first `limit` matches. A broad query still makes the server return every match; once the limit is reached and the output passes 256 KiB, the tool kills tgrep and runs ripgrep, which stops at the limit.

A named directory that the index ignores, such as `node_modules/pkg`, has no indexed files, so the server answers it with no matches while ripgrep searches it. An empty server result for a search path below the indexed root is therefore checked with ripgrep. A non-empty result cannot come from such a directory, and an empty result for the indexed root is trusted.

The server applies file changes asynchronously; on macOS a change was searchable after about 40ms. A search that follows a `write` or `edit` within 2 seconds uses ripgrep. Changes made through `bash` are not tracked.
