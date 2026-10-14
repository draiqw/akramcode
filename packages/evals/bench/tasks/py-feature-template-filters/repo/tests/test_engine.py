import unittest

from tmpl import render


class EngineTests(unittest.TestCase):
    def test_variable(self):
        self.assertEqual(render("Hello {{ name }}!", {"name": "Ann"}), "Hello Ann!")

    def test_dotted(self):
        self.assertEqual(render("{{user.city}}", {"user": {"city": "Oslo"}}), "Oslo")

    def test_missing(self):
        self.assertEqual(render("[{{ nope }}]", {}), "[]")

    def test_upper(self):
        self.assertEqual(render("{{ name|upper }}", {"name": "Ann"}), "ANN")


if __name__ == "__main__":
    unittest.main()
