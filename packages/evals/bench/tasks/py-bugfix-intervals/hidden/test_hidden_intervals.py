import unittest

from intervals import free_slots, merge_intervals


class HiddenMerge(unittest.TestCase):
    def test_touching(self):
        self.assertEqual(merge_intervals([(1, 5), (5, 7)]), [(1, 7)])

    def test_unsorted(self):
        self.assertEqual(merge_intervals([(8, 10), (1, 3), (2, 6)]), [(1, 6), (8, 10)])

    def test_unsorted_touching_chain(self):
        self.assertEqual(merge_intervals([(7, 9), (1, 3), (3, 5), (5, 7), (20, 21)]), [(1, 9), (20, 21)])

    def test_contained(self):
        self.assertEqual(merge_intervals([(1, 10), (2, 3), (4, 5)]), [(1, 10)])

    def test_no_mutation(self):
        data = [(5, 6), (1, 2)]
        merge_intervals(data)
        self.assertEqual(data, [(5, 6), (1, 2)])

    def test_returns_tuples(self):
        result = merge_intervals([(3, 4), (1, 2)])
        self.assertEqual(result, [(1, 2), (3, 4)])
        self.assertTrue(all(isinstance(item, tuple) for item in result))

    def test_point_intervals(self):
        self.assertEqual(merge_intervals([(4, 4), (4, 4), (2, 2)]), [(2, 2), (4, 4)])

    def test_empty(self):
        self.assertEqual(merge_intervals([]), [])

    def test_invalid(self):
        with self.assertRaises(ValueError):
            merge_intervals([(1, 2), (5, 3)])


class HiddenFreeSlots(unittest.TestCase):
    def test_unsorted_touching_busy(self):
        self.assertEqual(free_slots([(13, 15), (10, 12), (12, 13)], 9, 17), [(9, 10), (15, 17)])

    def test_busy_outside_day(self):
        self.assertEqual(free_slots([(1, 2), (20, 22)], 9, 17), [(9, 17)])

    def test_fully_busy(self):
        self.assertEqual(free_slots([(12, 17), (8, 12)], 9, 17), [])


if __name__ == "__main__":
    unittest.main()
