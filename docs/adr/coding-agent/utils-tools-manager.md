# Tools Manager

Source: packages/coding-agent/src/utils/tools-manager.ts

## GitHub Releases API Quota Strategy

The api.github.com releases endpoint counts against the 60 requests/hour anonymous API quota, which is permanently exhausted behind shared egress IPs like corporate proxies and CI runners. Using the web endpoint instead returns a redirect to the tagged release at no quota cost, and the redirect lives on the same origin as the binary download.

## Preserving Response Connection Reusability

Only status and headers are needed from the GitHub releases redirect response. The response body is discarded to allow the connection to be reused for subsequent operations, improving performance during tool downloads.

## Windows tar.exe for Zip Extraction

Windows ships bsdtar as tar.exe, which supports zip files. This is preferred over Git Bash's GNU tar because GNU tar does not handle zip archives. The System32 binary is used to ensure correct behavior.

## FD Version Pinning on Darwin x64

FD is pinned to version 10.3.0 on darwin/x64 to skip version lookup, optimizing startup performance. Other platforms and architectures perform a dynamic version lookup.

## Unique Temp Directory for Concurrent Downloads

Extracted archives are placed in a unique temporary directory using PID, timestamp, and random suffix. This prevents races when fd and rg downloads run concurrently during startup, which would occur if they shared a fixed directory.

## Binary Location Search in Archives

Archives may contain binaries at the root or nested under a versioned subdirectory. The search looks in both expected locations before falling back to a recursive search.

## Android/Termux Platform Incompatibility

On Android/Termux, Linux binaries do not work due to Bionic libc incompatibility. Users must install tools via the pkg package manager instead of downloading precompiled binaries.

## Error Cause Chain Traversal

Fetch failures may surface as a bare "fetch failed" TypeError with actionable details (DNS, TLS, timeout) hidden in the cause chain. The error messages are collected by traversing the cause chain with depth-capping to prevent infinite loops from circular references.
