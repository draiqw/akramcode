import json
import pathlib
import unittest


class AnswerTest(unittest.TestCase):
    def test_answer(self):
        data = json.loads(pathlib.Path("ANSWER.json").read_text())
        self.assertEqual(
            data,
            {"http.timeout_seconds": 25, "cache.ttl_seconds": 1200, "workers.max": 16},
        )
        for value in data.values():
            self.assertIs(type(value), int)


if __name__ == "__main__":
    unittest.main()
