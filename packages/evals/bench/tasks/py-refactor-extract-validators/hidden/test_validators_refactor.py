import ast
import pathlib
import unittest

from shop import customers, newsletter, orders, shipping, store
from shop import validators

MODULES = ["customers", "orders", "shipping", "newsletter"]
KEYWORDS = ("email", "phone", "postcode", "post_code", "zip", "sms_number")


def _tree(name):
    return ast.parse(pathlib.Path("shop", name + ".py").read_text())


class StructureTest(unittest.TestCase):
    def test_validators_module_api(self):
        for fn in ("is_valid_email", "normalize_phone", "is_valid_postcode"):
            self.assertTrue(callable(getattr(validators, fn, None)), fn)

    def test_modules_import_validators(self):
        for name in MODULES:
            tree = _tree(name)
            found = False
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    if node.module in ("validators", "shop.validators") or (
                        node.module is None and any(a.name == "validators" for a in node.names)
                    ):
                        found = True
                    if node.module == "shop" and any(a.name == "validators" for a in node.names):
                        found = True
                elif isinstance(node, ast.Import) and any(a.name == "shop.validators" for a in node.names):
                    found = True
            self.assertTrue(found, f"shop/{name}.py does not import shop.validators")

    def test_no_local_copies(self):
        for name in MODULES:
            tree = _tree(name)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    lowered = node.name.lower()
                    self.assertFalse(
                        any(k in lowered for k in KEYWORDS),
                        f"shop/{name}.py still defines helper {node.name}",
                    )
                if isinstance(node, ast.Assign) and isinstance(node.value, ast.Lambda):
                    self.fail(f"shop/{name}.py still defines a lambda helper")
        # the original private helper names must be gone everywhere
        for name in MODULES:
            src = pathlib.Path("shop", name + ".py").read_text()
            for old in ("_valid_email", "_clean_phone", "_email_ok", "_postcode_ok", "_is_postcode",
                        "_normalize_phone", "is_email", "_sms_number"):
                self.assertNotRegex(src, r"\b" + old + r"\b", f"{name}: {old}")


class ValidatorBehaviorTest(unittest.TestCase):
    def test_email(self):
        v = validators.is_valid_email
        for ok in ("a@b.co", "  first.last@sub.example.org ", "x+tag@d.io"):
            self.assertTrue(v(ok), ok)
        for bad in ("", "a@b", "@b.co", "a@@b.co", "a@b.co@c.de", "a@.b.co", "a@b.co.", "plain"):
            self.assertFalse(v(bad), bad)

    def test_phone(self):
        n = validators.normalize_phone
        self.assertEqual(n("+1 (555) 123-4567"), "+15551234567")
        self.assertEqual(n("0049 30.1234.5678"), "+493012345678")
        for bad in ("12345", "+1234567", "+1234567890123456", "555-CALL-NOW", "(555) 123-4567"):
            with self.assertRaises(ValueError, msg=bad):
                n(bad)

    def test_postcode(self):
        p = validators.is_valid_postcode
        for ok in ("12345", " 12345 ", "12345-6789"):
            self.assertTrue(p(ok), ok)
        for bad in ("1234", "123456", "12345-678", "ABCDE", "12345 6789", ""):
            self.assertFalse(p(bad), bad)


class PublicBehaviorTest(unittest.TestCase):
    def setUp(self):
        store.reset()

    def test_customers(self):
        c = customers.register_customer(" Bo ", "BO@Example.com", "0044 20 7946 0958")
        self.assertEqual(c, {"name": "Bo", "email": "bo@example.com", "phone": "+442079460958"})
        self.assertEqual(customers.change_contact("bo@example.com", "+1-555-000-1111")["phone"], "+15550001111")
        with self.assertRaises(ValueError):
            customers.register_customer("Bo", "bo@example", "+15550001111")
        with self.assertRaises(ValueError):
            customers.register_customer("Bo", "bo@example.com", "123")

    def test_orders(self):
        o = orders.place_order(" A@B.co ", [("x", 3, 0.5), ("y", 1, 2.0)], " 12345-6789 ")
        self.assertEqual(o, {"id": 1, "email": "a@b.co", "postcode": "12345-6789", "total": 3.5})
        with self.assertRaises(ValueError):
            orders.place_order("a@b", [("x", 1, 1.0)], "12345")
        with self.assertRaises(ValueError):
            orders.place_order("a@b.co", [("x", 1, 1.0)], "123")

    def test_shipping(self):
        self.assertEqual(shipping.quote_shipping("90210", 0.5), 8.5)
        self.assertEqual(shipping.quote_shipping("10001-1234", 3.0), 6.9)
        self.assertEqual(shipping.courier_contact("+49 (30) 1234-5678"), "courier:+493012345678")
        with self.assertRaises(ValueError):
            shipping.quote_shipping("1000", 1.0)

    def test_newsletter(self):
        self.assertTrue(newsletter.subscribe("Z@Q.io"))
        self.assertFalse(newsletter.subscribe("z@q."))
        self.assertEqual(newsletter.subscribe_sms("0033 1 23 45 67 89"), "+33123456789")
        self.assertEqual(newsletter.subscriber_count(), 2)
        with self.assertRaises(ValueError):
            newsletter.subscribe_sms("12")


if __name__ == "__main__":
    unittest.main()
