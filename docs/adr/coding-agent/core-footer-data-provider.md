# Footer Data Provider
Source: packages/coding-agent/src/core/footer-data-provider.ts

## Watch directory, not HEAD file directly
Git uses atomic writes (write temp, rename over HEAD), which changes the inode. fs.watch on a file stops working after the inode changes. Watch the directory containing HEAD instead.

## Monitor reftable repos separately
In reftable repos, branch switches update files in the reftable directory instead of HEAD. Watch it separately so the footer picks up those changes immediately.
