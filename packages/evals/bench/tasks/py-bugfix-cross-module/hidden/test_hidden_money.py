import unittest
from decimal import Decimal

from shop.invoice import build_invoice
from shop.pricing import line_discount, line_total
from shop.tax import compute_tax


class HiddenPricing(unittest.TestCase):
    def assertMoney(self, value, expected):
        self.assertIsInstance(value, Decimal)
        self.assertEqual(value, Decimal(expected))
        self.assertEqual(value.as_tuple().exponent, -2)

    def test_half_discount(self):
        self.assertMoney(line_discount("10.05", 1, 50), "5.03")
        self.assertMoney(line_total("10.05", 1, 50), "5.02")

    def test_ten_percent(self):
        self.assertMoney(line_discount("8.35", 1, 10), "0.84")
        self.assertMoney(line_total("8.35", 1, 10), "7.51")

    def test_mixed_input_types(self):
        self.assertMoney(line_discount(Decimal("1.15"), 3, "15"), "0.52")
        self.assertMoney(line_total(Decimal("1.15"), 3, Decimal("15")), "2.93")

    def test_no_discount(self):
        self.assertMoney(line_discount("12.50", 2, 0), "0.00")
        self.assertMoney(line_total("12.50", 2, 0), "25.00")
        self.assertMoney(line_total(3, 2, 0), "6.00")


class HiddenTax(unittest.TestCase):
    def test_half_up(self):
        self.assertEqual(compute_tax(Decimal("8.35"), "0.10"), Decimal("0.84"))
        self.assertEqual(compute_tax(Decimal("1.15"), Decimal("0.5")), Decimal("0.58"))
        self.assertEqual(compute_tax(Decimal("2.50"), "0.07"), Decimal("0.18"))

    def test_type_and_scale(self):
        tax = compute_tax(Decimal("100.00"), "0.0725")
        self.assertIsInstance(tax, Decimal)
        self.assertEqual(tax, Decimal("7.25"))
        self.assertEqual(tax.as_tuple().exponent, -2)


class HiddenInvoice(unittest.TestCase):
    def test_full_invoice(self):
        invoice = build_invoice(
            [
                {"sku": "NB-A5", "qty": 1, "discount_pct": 50},
                {"sku": "MUG", "qty": 1, "discount_pct": 10},
                {"sku": "PEN", "qty": 3, "discount_pct": 15},
                {"sku": "BAG", "qty": 2},
            ],
            "0.0725",
        )
        self.assertEqual(
            [(line["sku"], line["unit_price"], line["discount"], line["total"]) for line in invoice["lines"]],
            [
                ("NB-A5", "10.05", "5.03", "5.02"),
                ("MUG", "8.35", "0.84", "7.51"),
                ("PEN", "1.15", "0.52", "2.93"),
                ("BAG", "12.50", "0.00", "25.00"),
            ],
        )
        self.assertEqual(invoice["lines"][2]["qty"], 3)
        self.assertEqual(invoice["lines"][0]["name"], "A5 notebook")
        self.assertEqual(invoice["subtotal"], "40.46")
        self.assertEqual(invoice["discount"], "6.39")
        self.assertEqual(invoice["tax"], "2.93")
        self.assertEqual(invoice["total"], "43.39")

    def test_tax_rounding(self):
        invoice = build_invoice([{"sku": "MUG", "qty": 1}], "0.10")
        self.assertEqual(invoice["tax"], "0.84")
        self.assertEqual(invoice["total"], "9.19")

    def test_custom_catalog_and_string_types(self):
        catalog = {"X": {"name": "Thing", "price": "0.10"}}
        invoice = build_invoice([{"sku": "X", "qty": 3}], Decimal("0"), catalog=catalog)
        self.assertEqual(invoice["subtotal"], "0.30")
        self.assertEqual(invoice["total"], "0.30")
        for key in ("subtotal", "discount", "tax", "total"):
            self.assertIsInstance(invoice[key], str)


if __name__ == "__main__":
    unittest.main()
