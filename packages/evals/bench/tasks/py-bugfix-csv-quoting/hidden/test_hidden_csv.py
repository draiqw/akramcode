import unittest

from csvlite import format_line, parse_line, read_records


class HiddenParse(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(parse_line("a,b,c"), ["a", "b", "c"])

    def test_quoted_delimiter(self):
        self.assertEqual(parse_line('1,"Smith, John",x'), ["1", "Smith, John", "x"])

    def test_doubled_quotes(self):
        self.assertEqual(parse_line('"say ""hi""",2'), ['say "hi"', "2"])

    def test_only_doubled_quote(self):
        self.assertEqual(parse_line('""""'), ['"'])

    def test_quoted_empty(self):
        self.assertEqual(parse_line('"",x'), ["", "x"])

    def test_empty_fields(self):
        self.assertEqual(parse_line("a,,b"), ["a", "", "b"])

    def test_trailing_delimiter(self):
        self.assertEqual(parse_line("a,b,"), ["a", "b", ""])

    def test_empty_line(self):
        self.assertEqual(parse_line(""), [""])

    def test_quote_inside_unquoted_is_literal(self):
        self.assertEqual(parse_line('ab"c,d'), ['ab"c', "d"])

    def test_spaces_kept(self):
        self.assertEqual(parse_line(" a , b "), [" a ", " b "])

    def test_quoted_many_commas(self):
        self.assertEqual(parse_line('"a,b,c,d",e'), ["a,b,c,d", "e"])

    def test_tab_delimiter(self):
        self.assertEqual(parse_line('x\t"a\tb"\ty', delimiter="\t"), ["x", "a\tb", "y"])

    def test_unterminated(self):
        with self.assertRaises(ValueError):
            parse_line('a,"unclosed,b')

    def test_garbage_after_closing_quote(self):
        with self.assertRaises(ValueError):
            parse_line('"abc"d,e')

    def test_round_trip(self):
        values = ["plain", 'say "hi"', "a,b", "", '"', ",,"]
        self.assertEqual(parse_line(format_line(values)), values)


class HiddenRecords(unittest.TestCase):
    def test_quoted_records(self):
        text = 'id,name,note\n1,"Smith, John","he said ""no"""\n2,Bob,\n'
        self.assertEqual(
            read_records(text),
            [
                {"id": "1", "name": "Smith, John", "note": 'he said "no"'},
                {"id": "2", "name": "Bob", "note": ""},
            ],
        )


if __name__ == "__main__":
    unittest.main()
