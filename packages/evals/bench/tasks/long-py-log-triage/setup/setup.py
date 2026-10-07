"""Generate deterministic service logs into ./logs (cwd = workspace).

`python3 setup.py --expected` prints the expected ERROR_SUMMARY.json instead.
"""

import json
import os
import random
import sys

SERVICES = ["checkout", "pricing", "catalog", "auth"]
SHARDS = 8
CODES = {
    "E_TIMEOUT": 30,
    "E_UPSTREAM_5XX": 22,
    "E_RATE_LIMIT": 14,
    "E_AUTH": 10,
    "E_VALIDATION": 12,
    "E_DB_CONN": 6,
    "E_CONFLICT": 5,
    "E_PARSE": 5,
}
INFO_MSGS = [
    "request started path=/v1/quote",
    "request finished status=200 dur_ms={d}",
    "cache hit key=quote:{k}",
    "cache miss key=quote:{k}",
    "upstream call catalog.get_item item={k} dur_ms={d}",
    "db query table=quotes rows={k} dur_ms={d}",
    "user session refreshed ttl=3600",
    "feature flag evaluated flag=new_tax_engine value=false",
]
DEBUG_MSGS = [
    "payload size bytes={d}",
    "retry policy attempts=3 backoff_ms=200",
    "connection pool active={k} idle=4",
]
WARN_MSGS = {
    "E_TIMEOUT": "upstream slow, retrying (attempt {a}/3)",
    "E_RATE_LIMIT": "approaching rate limit, remaining={k}",
    "E_DB_CONN": "db connection reset, reconnecting",
    "E_UPSTREAM_5XX": "upstream returned 503, will retry",
}
ERR_MSGS = {
    "E_TIMEOUT": "upstream timed out after {d}ms",
    "E_UPSTREAM_5XX": "upstream catalog returned 502",
    "E_RATE_LIMIT": "rate limit exceeded for client c-{k}",
    "E_AUTH": "invalid or expired token",
    "E_VALIDATION": "country code is not supported",
    "E_DB_CONN": "could not acquire db connection within 5000ms",
    "E_CONFLICT": "quote version conflict, expected v{a}",
    "E_PARSE": "unhandled exception while handling quote",
}
# Misleading messages: ERROR entries whose msg text mentions another code.
DECOY_MSGS = [
    "giving up; previous attempts failed with code=E_TIMEOUT",
    "fallback failed (last error code=E_RATE_LIMIT)",
    "retry budget exhausted after code=E_PARSE on cached payload",
]
BAD_AMOUNTS = ["1,234.50", "12,000", "2,500.00", "10,999.99", "1,000,000.00", "3,450", "99,999.01"]


def build():
    rng = random.Random(20260301)
    files = {}
    counts = {code: 0 for code in CODES}
    parse_reqs = set()
    codes = list(CODES)
    weights = [CODES[c] for c in codes]
    t = 1772323200  # fixed epoch seconds
    for svc in SERVICES:
        for shard in range(1, SHARDS + 1):
            lines = []
            n = rng.randint(1000, 1400)
            for _ in range(n):
                t += rng.randint(0, 2)
                ms = rng.randint(0, 999)
                hh = (t // 3600) % 24
                mm = (t // 60) % 60
                ss = t % 60
                ts = f"2026-03-01T{hh:02d}:{mm:02d}:{ss:02d}.{ms:03d}Z"
                req = f"r-{rng.randint(1, 30000):06d}"
                roll = rng.random()
                fill = {"d": rng.randint(3, 4000), "k": rng.randint(1, 999), "a": rng.randint(1, 3)}
                if roll < 0.80:
                    msg = rng.choice(INFO_MSGS).format(**fill)
                    lines.append(f'{ts} INFO  svc={svc} req={req} msg="{msg}"')
                elif roll < 0.86:
                    msg = rng.choice(DEBUG_MSGS).format(**fill)
                    lines.append(f'{ts} DEBUG svc={svc} req={req} msg="{msg}"')
                elif roll < 0.94:
                    code = rng.choice(list(WARN_MSGS))
                    msg = WARN_MSGS[code].format(**fill)
                    lines.append(f'{ts} WARN  svc={svc} req={req} code={code} msg="{msg}"')
                else:
                    code = rng.choices(codes, weights)[0]
                    if code != "E_PARSE" and rng.random() < 0.06:
                        msg = rng.choice(DECOY_MSGS)
                    else:
                        msg = ERR_MSGS[code].format(**fill)
                    lines.append(f'{ts} ERROR svc={svc} req={req} code={code} msg="{msg}"')
                    counts[code] += 1
                    if code == "E_PARSE":
                        parse_reqs.add(req)
                        bad = rng.choice(BAD_AMOUNTS)
                        lines.extend(
                            [
                                "Traceback (most recent call last):",
                                '  File "service/handlers.py", line 14, in handle_quote',
                                "    net, tax, gross = quote_total(raw, country)",
                                '  File "service/pricing.py", line 33, in quote_total',
                                "    net = parse_amount(raw_amount)",
                                '  File "service/pricing.py", line 15, in parse_amount',
                                "    return int(round(float(text) * 100))",
                                f"ValueError: could not convert string to float: '{bad}'",
                            ]
                        )
                    elif code == "E_TIMEOUT" and rng.random() < 0.3:
                        lines.extend(
                            [
                                "Traceback (most recent call last):",
                                '  File "vendor/httpclient/session.py", line 812, in request',
                                "    raise TimeoutError(f\"read timed out after {timeout}ms\")",
                                "TimeoutError: read timed out",
                            ]
                        )
            files[f"logs/{svc}-{shard:02d}.log"] = "\n".join(lines) + "\n"
    expected = {"counts": counts, "parse_error_requests": sorted(parse_reqs)}
    return files, expected


def main():
    files, expected = build()
    if "--expected" in sys.argv:
        print(json.dumps(expected, indent=2, sort_keys=True))
        return
    for path, text in files.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()
