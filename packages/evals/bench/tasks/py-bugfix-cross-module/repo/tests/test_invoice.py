import unittest

from shop.invoice import build_invoice


class InvoiceTests(unittest.TestCase):
    def test_simple(self):
        invoice = build_invoice([{"sku": "BAG", "qty": 2}], "0.10")
        self.assertEqual(invoice["subtotal"], "25.00")
        self.assertEqual(invoice["tax"], "2.50")
        self.assertEqual(invoice["total"], "27.50")

    def test_ten_percent_discount(self):
        invoice = build_invoice([{"sku": "MUG", "qty": 1, "discount_pct": 10}], "0")
        self.assertEqual(invoice["lines"][0]["discount"], "0.84")
        self.assertEqual(invoice["lines"][0]["total"], "7.51")


if __name__ == "__main__":
    unittest.main()
