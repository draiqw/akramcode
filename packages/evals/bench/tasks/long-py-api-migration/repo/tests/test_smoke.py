import importlib
import os
import unittest

MODULE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "modules")


def module_names():
    return sorted(f[:-3] for f in os.listdir(MODULE_DIR) if f.endswith(".py") and f != "__init__.py")


class SmokeTest(unittest.TestCase):
    def test_every_module_runs(self):
        for name in module_names():
            with self.subTest(module=name):
                mod = importlib.import_module(f"app.modules.{name}")
                result = mod.run()
                self.assertIsInstance(result, list)
                self.assertTrue(result)


if __name__ == "__main__":
    unittest.main()
