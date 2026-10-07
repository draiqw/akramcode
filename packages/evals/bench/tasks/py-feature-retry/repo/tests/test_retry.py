import unittest

from retrying import retry


class RetryTests(unittest.TestCase):
    def test_returns_value(self):
        @retry(sleep=lambda s: None)
        def ok():
            return 42

        self.assertEqual(ok(), 42)

    def test_retries_then_succeeds(self):
        calls = []

        @retry(max_attempts=3, sleep=lambda s: None)
        def flaky():
            calls.append(1)
            if len(calls) < 3:
                raise OSError("boom")
            return "done"

        self.assertEqual(flaky(), "done")
        self.assertEqual(len(calls), 3)


if __name__ == "__main__":
    unittest.main()
