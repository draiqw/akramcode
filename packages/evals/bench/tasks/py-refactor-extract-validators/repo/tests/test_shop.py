import unittest

from shop import customers, newsletter, orders, shipping, store


class ShopTest(unittest.TestCase):
    def setUp(self):
        store.reset()

    def test_register(self):
        c = customers.register_customer("Ann", " Ann@Example.com ", "+1 (555) 123-4567")
        self.assertEqual(c["email"], "ann@example.com")
        self.assertRaises(ValueError, customers.register_customer, "Ann", "bad", "+15551234567")

    def test_order(self):
        o = orders.place_order("a@b.co", [("x", 2, 1.25)], "12345")
        self.assertEqual(o["total"], 2.5)
        self.assertRaises(ValueError, orders.place_order, "a@b.co", [("x", 1, 1.0)], "1234")

    def test_shipping(self):
        self.assertEqual(shipping.quote_shipping("40210", 2.0), 7.45)

    def test_newsletter(self):
        self.assertTrue(newsletter.subscribe("x@y.org"))
        self.assertFalse(newsletter.subscribe("x@y"))


if __name__ == "__main__":
    unittest.main()
