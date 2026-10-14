import unittest

from tmpl import render
from tmpl.errors import TemplateError


class User:
    def __init__(self, name):
        self.name = name


class HiddenFilters(unittest.TestCase):
    def test_plain_unchanged(self):
        self.assertEqual(render("Hello {{ name }}!", {"name": "Ann"}), "Hello Ann!")
        self.assertEqual(render("{{user.city}}", {"user": {"city": "Oslo"}}), "Oslo")
        self.assertEqual(render("[{{ nope }}]", {}), "[]")
        self.assertEqual(render("{{ n }}", {"n": None}), "")
        self.assertEqual(render("no tags | here: {x}", {}), "no tags | here: {x}")

    def test_upper_lower(self):
        self.assertEqual(render("{{ name|upper }}", {"name": "Ann"}), "ANN")
        self.assertEqual(render("{{ name|lower }}", {"name": "AnN"}), "ann")
        self.assertEqual(render("{{ n|upper }}", {"n": 42}), "42")
        self.assertEqual(render("[{{ nope|upper }}]", {}), "[]")

    def test_whitespace(self):
        self.assertEqual(render("{{ name | upper }}", {"name": "ann"}), "ANN")
        self.assertEqual(render("{{name|upper}}", {"name": "ann"}), "ANN")
        self.assertEqual(render("{{   name  |  lower   }}", {"name": "ANN"}), "ann")

    def test_default(self):
        self.assertEqual(render('{{ name|default:"anon" }}', {}), "anon")
        self.assertEqual(render('{{ name|default:"anon" }}', {"name": None}), "anon")
        self.assertEqual(render('{{ name|default:"anon" }}', {"name": ""}), "anon")
        self.assertEqual(render('{{ name|default:"anon" }}', {"name": "Bob"}), "Bob")
        self.assertEqual(render('{{ n|default:"x" }}', {"n": 0}), "0")

    def test_default_with_spaces_and_colons(self):
        self.assertEqual(render('{{ t|default:"at 10:30 today" }}', {}), "at 10:30 today")
        self.assertEqual(render('{{ t | default:"a b" | upper }}', {}), "A B")

    def test_chain_order(self):
        self.assertEqual(render('{{ name|default:"anon"|upper }}', {}), "ANON")
        self.assertEqual(render('{{ name|upper|default:"anon" }}', {}), "anon")
        self.assertEqual(render('{{ name|upper|lower }}', {"name": "MiXed"}), "mixed")

    def test_dotted_with_filters(self):
        self.assertEqual(render("{{ user.name|upper }}", {"user": User("ann")}), "ANN")
        self.assertEqual(render('{{ user.email|default:"none" }}', {"user": User("ann")}), "none")

    def test_multiple_tags(self):
        self.assertEqual(
            render('{{ a|upper }}-{{ b }}-{{ c|default:"z" }}', {"a": "x", "b": "y"}),
            "X-y-z",
        )

    def test_unknown_filter(self):
        with self.assertRaises(TemplateError) as ctx:
            render("{{ name|title }}", {"name": "ann"})
        self.assertEqual(str(ctx.exception), "unknown filter: title")


if __name__ == "__main__":
    unittest.main()
