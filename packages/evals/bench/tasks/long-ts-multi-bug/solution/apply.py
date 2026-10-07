"""Reference solution: rewrite the buggy stage modules with correct bodies and write FIXED.json."""

import json
import os
import sys

sys.dont_write_bytecode = True  # keep the task directory clean
sys.path.insert(0, os.path.join(os.environ["TASK_DIR"], "setup"))
import setup  # noqa: E402

ops = setup.op_defs()
fixed = []
for stage in setup.plan():
    if stage["n"] in setup.BUGGY:
        path = f"src/stages/stage{stage['n']:02d}.ts"
        with open(path, "w", encoding="utf-8") as f:
            f.write(setup.module_source(stage, ops, False))
        fixed.append(path)
with open("FIXED.json", "w", encoding="utf-8") as f:
    json.dump(sorted(fixed), f, indent=2)
