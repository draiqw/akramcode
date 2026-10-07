import unittest

from intervals import free_slots, merge_intervals


class MergeTests(unittest.TestCase):
    def test_overlapping(self):
        self.assertEqual(merge_intervals([(1, 3), (2, 6), (8, 10)]), [(1, 6), (8, 10)])

    def test_touching(self):
        self.assertEqual(merge_intervals([(1, 5), (5, 7)]), [(1, 7)])

    def test_empty(self):
        self.assertEqual(merge_intervals([]), [])


class FreeSlotTests(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(free_slots([(10, 12)], 9, 17), [(9, 10), (12, 17)])


if __name__ == "__main__":
    unittest.main()
