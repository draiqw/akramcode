"""Reference solution: compute the summary from the logs and fix parse_amount."""

import json
import os
import re

ENTRY = re.compile(r"^\S+ (INFO |DEBUG|WARN |ERROR) svc=\S+ req=(\S+)(?: code=(\S+))? msg=")

counts = {}
parse_reqs = set()
for name in sorted(os.listdir("logs")):
    with open(os.path.join("logs", name), encoding="utf-8") as f:
        for line in f:
            m = ENTRY.match(line)
            if not m or m.group(1) != "ERROR":
                continue
            code = m.group(3)
            counts[code] = counts.get(code, 0) + 1
            if code == "E_PARSE":
                parse_reqs.add(m.group(2))

with open("ERROR_SUMMARY.json", "w", encoding="utf-8") as f:
    json.dump({"counts": counts, "parse_error_requests": sorted(parse_reqs)}, f, indent=2)

path = os.path.join("service", "pricing.py")
with open(path, encoding="utf-8") as f:
    src = f.read()
src = src.replace(
    "    text = text.strip()\n    return int(round(float(text) * 100))",
    "    text = text.strip()\n    if not re.fullmatch(r\"\\d{1,3}(,\\d{3})+(\\.\\d+)?|\\d+(\\.\\d+)?\", text):\n"
    "        raise ValueError(f\"invalid amount: {text!r}\")\n"
    "    return int(round(float(text.replace(\",\", \"\")) * 100))",
)
src = src.replace('"""Pricing helpers used by the quote service."""\n', '"""Pricing helpers used by the quote service."""\n\nimport re\n', 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
