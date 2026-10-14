import unittest

from service.handlers import handle_quote
from service.pricing import compute_tax, format_cents, parse_amount


class PricingTest(unittest.TestCase):
    def test_parse_simple(self):
        self.assertEqual(parse_amount("12"), 1200)
        self.assertEqual(parse_amount("12.5"), 1250)
        self.assertEqual(parse_amount(" 7.25 "), 725)

    def test_tax(self):
        self.assertEqual(compute_tax(10000, "DE"), 1900)

    def test_format(self):
        self.assertEqual(format_cents(123450), "1234.50")
        self.assertEqual(format_cents(-5), "-0.05")

    def test_handler(self):
        self.assertEqual(handle_quote({"amount": "100", "country": "US"}), {"net": "100.00", "tax": "7.00", "gross": "107.00"})


if __name__ == "__main__":
    unittest.main()
