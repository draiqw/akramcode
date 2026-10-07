import unittest

from orbit.config import load_config
from orbit.config.envfile import parse_env_file


class ConfigTest(unittest.TestCase):
    def test_dev_defaults(self):
        c = load_config("dev", {})
        self.assertEqual(c["log.level"], "debug")
        self.assertEqual(c["plugins.enabled"], ["metrics", "audit"])

    def test_env_file_parser(self):
        env = parse_env_file("# c\nA=1\nexport B='x y'\n")
        self.assertEqual(env, {"A": "1", "B": "x y"})


if __name__ == "__main__":
    unittest.main()
