# Migrating from app.legacy to app.client

`app.legacy.fetch` and `app.legacy.Timeout` are deprecated. Every use must move to the shared client
in `app/client.py`:

```python
from app.client import client, Retry
```

Mapping (import only the names a module actually uses):

| Old | New |
| --- | --- |
| `legacy.fetch(URL)` | `client.get(URL)` |
| `legacy.fetch(URL, retries=N)` | `client.get(URL, retry=Retry(N))` |
| `legacy.fetch(URL, N)` (positional retries) | `client.get(URL, retry=Retry(N))` |
| `legacy.fetch(URL, retries=0)` | `client.get(URL)` (no retry argument) |
| `timeout=legacy.Timeout(S)` | `timeout=S` (plain seconds) |
| `t = legacy.Timeout(S)` ... `timeout=t` | `t = S` ... `timeout=t` |

`N` and `S` may be literals or expressions (for example `self.max_retries`); keep the expression as is.
`Retry(N)` requires N >= 1, which is why literal `retries=0` drops the argument entirely.

Modules may import the legacy API in different ways (`from app import legacy`,
`from app import legacy as lg`, `from app.legacy import fetch, Timeout`). After migration no module
under `app/modules/` may import `app.legacy` in any form. Text that merely mentions the old API
(strings, docstrings, comments) is documentation and must stay unchanged, and so must unrelated
functions that happen to be called `fetch`.
