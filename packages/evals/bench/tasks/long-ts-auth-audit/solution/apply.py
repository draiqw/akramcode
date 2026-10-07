"""Reference solution: render every handler in its fixed form and write AUDIT.json."""

import json
import os
import sys

sys.dont_write_bytecode = True  # keep the task directory clean
sys.path.insert(0, os.path.join(os.environ["TASK_DIR"], "setup"))
import setup  # noqa: E402

changed = []
for route in setup.plan():
    if route["state"] in ("ok", "public_ok"):
        continue
    with open(route["file"], "w", encoding="utf-8") as f:
        f.write(setup.render(route, fixed=True))
    changed.append(route["key"])
with open("AUDIT.json", "w", encoding="utf-8") as f:
    json.dump({"changed": sorted(changed)}, f, indent=2)
