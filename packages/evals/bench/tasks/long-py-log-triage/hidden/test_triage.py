import json
import os
import unittest

from service.handlers import handle_quote
from service.pricing import compute_tax, format_cents, parse_amount

HERE = os.path.dirname(os.path.abspath(__file__))


def load_expected():
    with open(os.path.join(HERE, "expected.json"), encoding="utf-8") as f:
        return json.load(f)


class SummaryTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.path.exists("ERROR_SUMMARY.json"), "ERROR_SUMMARY.json missing")
        with open("ERROR_SUMMARY.json", encoding="utf-8") as f:
            self.summary = json.load(f)
        self.expected = load_expected()

    def test_counts(self):
        counts = {k: v for k, v in self.summary["counts"].items() if v != 0}
        expected = {k: v for k, v in self.expected["counts"].items() if v != 0}
        self.assertEqual(counts, expected)

    def test_parse_error_requests(self):
        self.assertEqual(list(self.summary["parse_error_requests"]), self.expected["parse_error_requests"])


class ParseAmountTest(unittest.TestCase):
    def test_thousands_separators(self):
        self.assertEqual(parse_amount("1,234.50"), 123450)
        self.assertEqual(parse_amount("12,000"), 1200000)
        self.assertEqual(parse_amount("1,000,000.99"), 100000099)
        self.assertEqual(parse_amount(" 3,450 "), 345000)
        self.assertEqual(parse_amount("99,999.01"), 9999901)

    def test_plain_forms_still_work(self):
        self.assertEqual(parse_amount("12"), 1200)
        self.assertEqual(parse_amount("12.5"), 1250)
        self.assertEqual(parse_amount("12.50"), 1250)
        self.assertEqual(parse_amount(" 7.25 "), 725)

    def test_invalid_still_raises(self):
        for bad in ["", "abc", "  ", "12.5x"]:
            with self.assertRaises(ValueError):
                parse_amount(bad)

    def test_other_helpers_unchanged(self):
        self.assertEqual(compute_tax(10000, "DE"), 1900)
        self.assertEqual(format_cents(123450), "1234.50")
        self.assertEqual(
            handle_quote({"amount": "1,000", "country": "US"}),
            {"net": "1000.00", "tax": "70.00", "gross": "1070.00"},
        )


if __name__ == "__main__":
    unittest.main()
