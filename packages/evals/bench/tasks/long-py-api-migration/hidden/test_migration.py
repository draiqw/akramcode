import ast
import hashlib
import importlib
import json
import os
import unittest

from app import legacy
from app.client import client

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "expected.json"), encoding="utf-8") as f:
    EXPECTED = json.load(f)


def imports_legacy(path):
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(a.name == "app.legacy" or a.name.startswith("app.legacy.") for a in node.names):
                return True
        if isinstance(node, ast.ImportFrom):
            if node.module == "app.legacy":
                return True
            if node.module == "app" and any(a.name == "legacy" for a in node.names):
                return True
    return False


class MigrationTest(unittest.TestCase):
    def test_no_module_imports_legacy(self):
        offenders = []
        for name in EXPECTED["modules"]:
            path = os.path.join("app", "modules", name + ".py")
            if imports_legacy(path):
                offenders.append(path)
        self.assertEqual(offenders, [])

    def test_modules_use_new_client_correctly(self):
        for name, exp in EXPECTED["modules"].items():
            with self.subTest(module=name):
                mod = importlib.import_module(f"app.modules.{name}")
                legacy.calls.clear()
                client.calls.clear()
                result = mod.run()
                self.assertEqual(legacy.calls, [], "legacy API still used")
                self.assertEqual([list(c) for c in client.calls], exp["calls"])
                self.assertEqual(result, exp["result"])

    def test_distractors_untouched(self):
        for path, digest in EXPECTED["distractors"].items():
            with open(path, encoding="utf-8") as f:
                actual = hashlib.sha256(f.read().encode("utf-8")).hexdigest()
            self.assertEqual(actual, digest, f"{path} must not change")

    def test_report(self):
        with open("MIGRATION_REPORT.json", encoding="utf-8") as f:
            report = json.load(f)
        modules = [p[2:] if p.startswith("./") else p for p in report["migrated_modules"]]
        self.assertEqual(modules, EXPECTED["migrated_modules"])
        self.assertEqual(report["call_sites"], EXPECTED["call_sites"])


if __name__ == "__main__":
    unittest.main()
