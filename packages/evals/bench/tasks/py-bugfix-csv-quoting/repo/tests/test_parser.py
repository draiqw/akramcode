import unittest

from csvlite import format_line, parse_line, read_records


class ParserTests(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(parse_line("a,b,c"), ["a", "b", "c"])

    def test_quoted_comma(self):
        self.assertEqual(parse_line('1,"Smith, John",x'), ["1", "Smith, John", "x"])

    def test_round_trip(self):
        values = ["plain", 'say "hi"', "a,b"]
        self.assertEqual(parse_line(format_line(values)), values)


class ReaderTests(unittest.TestCase):
    def test_records(self):
        text = "id,name\n1,Ann\n2,Bob\n"
        self.assertEqual(read_records(text), [{"id": "1", "name": "Ann"}, {"id": "2", "name": "Bob"}])


if __name__ == "__main__":
    unittest.main()
