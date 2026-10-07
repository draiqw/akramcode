"""Reference solution: render every legacy module in migrated form and write the report."""

import json
import os
import sys

sys.dont_write_bytecode = True  # keep the task directory clean
sys.path.insert(0, os.path.join(os.environ["TASK_DIR"], "setup"))
import setup  # noqa: E402

migrated = []
sites = 0
for mod in setup.plan():
    if mod["style"] == "migrated":
        continue
    path = f"app/modules/{mod['name']}.py"
    with open(path, "w", encoding="utf-8") as f:
        f.write(setup.render(mod, migrated=True))
    migrated.append(path)
    sites += len(mod["sites"])
with open("MIGRATION_REPORT.json", "w", encoding="utf-8") as f:
    json.dump({"migrated_modules": sorted(migrated), "call_sites": sites}, f, indent=2)
